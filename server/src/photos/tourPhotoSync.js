import fs from 'fs';
import path from 'path';
import config from '../config.js';
import Tour from '../models/tourModel.js';
import { findFolderForOrder } from './tourFolders.js';
import { byTakenAt, isImageFile, processPhoto, readTakenAt, thumbRelPath } from './imageFiles.js';

// A tour's album = the photos in its folder under PHOTOS_ROOT, plus the ones
// in its "mobil" subfolder (phone photos - marked, so the site can show a
// small phone icon on them). Any other subfolder is left out and reported.
const MOBILE_FOLDER = 'mobil';

// Pure, so it's unit-testable: what's new (needs a thumbnail) and what's
// gone (its file was deleted or renamed).
export function diffTourImages(filesOnDisk, recordedImages) {
  const onDisk = new Set(filesOnDisk);
  const existing = new Set(recordedImages.map((i) => i.filename));
  const newFilenames = filesOnDisk.filter((f) => !existing.has(f));
  const removedImages = recordedImages.filter((i) => !onDisk.has(i.filename));
  return { newFilenames, removedImages };
}

// The album's files, as paths relative to the tour folder - always with
// "/" ("mobil/IMG_1.jpg"), whatever the OS - and the subfolders left out.
export function listTourPhotoFiles(folderPath) {
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && isImageFile(e.name)).map((e) => e.name);
  const skipped = [];
  for (const dir of entries.filter((e) => e.isDirectory())) {
    const inside = fs.readdirSync(path.join(folderPath, dir.name), { withFileTypes: true });
    const photos = inside.filter((e) => e.isFile() && isImageFile(e.name)).map((e) => e.name);
    if (dir.name.toLowerCase() === MOBILE_FOLDER) {
      files.push(...photos.map((name) => `${dir.name}/${name}`));
    } else if (photos.length) {
      skipped.push(`${dir.name} (${photos.length})`);
    }
  }
  return { files, skipped };
}

const isMobile = (filename) => filename.toLowerCase().startsWith(`${MOBILE_FOLDER}/`);

// Brings one tour's album in line with its folder: new photos get a
// thumbnail and their facts, deleted ones go, and the album is kept in the
// order the photos were taken. The tour must be loaded with
// '+images +sourceFolder'. Returns a summary for the report.
export async function syncTourPhotos(tour, sharp) {
  const folderPath = path.join(config.photosRoot, tour.sourceFolder);
  if (!fs.existsSync(folderPath)) throw new Error(`a mappa nem található: ${tour.sourceFolder}`);

  const { files, skipped } = listTourPhotoFiles(folderPath);
  const { newFilenames, removedImages } = diffTourImages(files, tour.images);
  const thumbDir = path.join(config.thumbnailsRoot, tour.sourceFolder);

  const added = [];
  let failures = 0;
  for (const filename of newFilenames) {
    try {
      const facts = await processPhoto(
        sharp,
        path.join(folderPath, filename),
        path.join(thumbDir, thumbRelPath(filename)),
      );
      added.push({ filename, ...facts, ...(isMobile(filename) ? { source: 'mobile' } : {}) });
    } catch {
      failures++;
    }
  }

  // Thumbnails of deleted photos - best effort, a leftover one is harmless.
  for (const image of removedImages) {
    fs.rmSync(path.join(thumbDir, thumbRelPath(image.filename)), { force: true });
  }

  // Photos recorded before takenAt existed get it once (null = the file has
  // none, so it isn't read again next time).
  let dated = 0;
  for (const image of tour.images) {
    if (image.takenAt === undefined) {
      image.takenAt = await readTakenAt(path.join(folderPath, image.filename));
      dated++;
    }
  }

  const removed = new Set(removedImages.map((i) => i.filename));
  const images = [
    ...tour.images.filter((i) => !removed.has(i.filename)).map((i) => i.toObject?.() ?? i),
    ...added,
  ].sort(byTakenAt);
  const reordered = images.some((i, n) => i.filename !== tour.images[n]?.filename);

  if (added.length || removed.size || dated || reordered) {
    tour.images = images;
    await tour.save({ validateModifiedOnly: true });
  }
  return {
    title: `${tour.order}. ${tour.title}`,
    added: added.length,
    removed: removed.size,
    total: images.length,
    failures,
    skipped,
  };
}

// Links tours that have no photo folder yet to the one whose name ends in
// their number - a newly created folder is picked up by itself.
export async function matchNewTourFolders() {
  const tours = await Tour.find({
    $or: [{ sourceFolder: { $exists: false } }, { sourceFolder: null }, { sourceFolder: '' }],
  }).select('order title +sourceFolder');
  const matched = [];
  for (const tour of tours) {
    if (!tour.order) continue;
    const folder = findFolderForOrder(tour.order);
    if (!folder) continue;
    tour.sourceFolder = folder;
    await tour.save({ validateModifiedOnly: true });
    matched.push(`${tour.order}. ${tour.title} → ${folder}`);
  }
  return matched;
}

// Every tour with a folder - the tour part of "Új média felfedezése".
export async function syncAllTourPhotos(sharp) {
  const tours = await Tour.find({ sourceFolder: { $nin: [null, ''] } }).select(
    'order title +images +sourceFolder',
  );
  const results = [];
  for (const tour of tours.sort((a, b) => a.order - b.order)) {
    try {
      results.push(await syncTourPhotos(tour, sharp));
    } catch (err) {
      results.push({ title: `${tour.order}. ${tour.title}`, error: err.message });
    }
  }
  return results;
}
