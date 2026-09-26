// Reads a tour's photo folder (PHOTOS_ROOT/<tour.sourceFolder>/, see
// matchTourFolders.js for how sourceFolder gets set) and appends any image
// file not already recorded in tour.images, preserving the existing order
// of already-recorded photos across re-syncs - new ones are just appended
// after them. Also generates a small .webp thumbnail per newly-added photo
// via sharp, written to THUMBNAILS_ROOT/<sourceFolder>/ - sharp only ever
// runs here, never inside the bundled server (see
// tour-photos-implementation-plan.md for why that split matters).
//
// Also prunes the other direction: any tour.images entry whose file no
// longer exists in the folder (deleted or renamed by hand) is removed,
// along with its thumbnail - closes the gap where a deleted photo would
// otherwise keep being served indefinitely, orphaned from the real
// folder. This only runs once the folder listing itself has already
// succeeded (see the fs.existsSync check below), so a momentarily
// unreachable/empty PHOTOS_ROOT can't be misread as "every photo was
// deleted."
//
// Only reads files directly under the tour's folder - a few real folders
// have subfolders (e.g. a separate phone-photos dump); those are printed
// as a notice rather than silently skipped, walking into them is a
// deferred follow-up (see the plan).
//
// Usage:
//   node scripts/syncTourImages.js <tourId|order|slug>

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import mongoose from 'mongoose';
import sharp from 'sharp';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic']);
const THUMB_WIDTH = 400;

// Pure (no DB/filesystem) so it's directly unit-testable - given the
// current file listing and the tour's recorded images, decides what's new
// (needs a thumbnail generated) and what's stale (file's gone, needs
// pruning). filesOnDisk/recordedImages are never mutated.
export function diffTourImages(filesOnDisk, recordedImages) {
  const onDisk = new Set(filesOnDisk);
  const existing = new Set(recordedImages.map((i) => i.filename));
  const newFilenames = filesOnDisk.filter((f) => !existing.has(f));
  const removedImages = recordedImages.filter((i) => !onDisk.has(i.filename));
  return { newFilenames, removedImages };
}

// The actual sync for one already-loaded tour (mongoose already connected,
// tour.sourceFolder already set) - factored out of main() below so
// refreshTourPhotos.js can call it directly after matching a folder,
// without shelling out to a second process or re-connecting to the DB.
// Returns a short summary object instead of just printing, so a caller
// combining this with matchTourFolders' own logic can build one combined
// report rather than interleaved console output from two scripts.
export async function syncOneTour(tour) {
  const folderPath = path.join(config.photosRoot, tour.sourceFolder);
  if (!fs.existsSync(folderPath)) {
    throw new Error(`Folder not found: ${folderPath}`);
  }

  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const subfolderNotices = [];
  for (const sub of entries.filter((e) => e.isDirectory())) {
    const count = fs.readdirSync(path.join(folderPath, sub.name)).length;
    if (count > 0) {
      subfolderNotices.push(
        `Note: subfolder "${sub.name}" (${count} file(s)) was not read - subfolders aren't walked yet, see the plan.`,
      );
    }
  }

  const files = entries
    .filter((e) => e.isFile() && IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  const { newFilenames, removedImages } = diffTourImages(files, tour.images);

  if (newFilenames.length === 0 && removedImages.length === 0) {
    return {
      message: `"${tour.title}": no changes (${tour.images.length} already recorded, all still present).`,
      subfolderNotices,
    };
  }

  const thumbDir = path.join(config.thumbnailsRoot, tour.sourceFolder);
  fs.mkdirSync(thumbDir, { recursive: true });

  let thumbsGenerated = 0;
  let thumbFailures = 0;
  const added = [];
  for (const filename of newFilenames) {
    const src = path.join(folderPath, filename);
    const dest = path.join(thumbDir, `${path.parse(filename).name}.webp`);
    try {
      // .rotate() with no args auto-orients based on the source's own EXIF
      // tag - without it, a portrait phone/camera photo can come out
      // sideways once EXIF is stripped by re-encoding to webp, and the
      // width/height PhotoSwipe needs would be the pre-rotation (wrong) ones.
      const { width, height } = await sharp(src).rotate().metadata();
      const { size } = fs.statSync(src);
      await sharp(src).rotate().resize({ width: THUMB_WIDTH }).webp({ quality: 75 }).toFile(dest);
      added.push({ filename, width, height, size });
      thumbsGenerated++;
    } catch (err) {
      console.error(`Failed to process "${filename}": ${err.message}`);
      thumbFailures++;
    }
  }

  // Prune entries whose backing file is gone - best-effort thumbnail
  // cleanup (a missing thumbnail is harmless to ignore; the DB entry being
  // gone is what actually stops it from being served).
  for (const image of removedImages) {
    const thumbPath = path.join(thumbDir, `${path.parse(image.filename).name}.webp`);
    try {
      fs.rmSync(thumbPath, { force: true });
    } catch (err) {
      console.error(`Could not remove thumbnail for "${image.filename}": ${err.message}`);
    }
  }
  if (removedImages.length > 0) {
    const removedFilenames = new Set(removedImages.map((i) => i.filename));
    tour.images = tour.images.filter((i) => !removedFilenames.has(i.filename));
  }

  tour.images.push(...added);
  await tour.save();

  const message =
    `"${tour.title}": added ${added.length} new photo(s), removed ${removedImages.length} stale entr${
      removedImages.length === 1 ? 'y' : 'ies'
    } (${tour.images.length} total), generated ${thumbsGenerated} thumbnail(s)${
      thumbFailures ? `, ${thumbFailures} failure(s)` : ''
    }.` + (removedImages.length > 0 ? `\nRemoved (file no longer in folder): ${removedImages.map((i) => i.filename).join(', ')}` : '');

  return { message, subfolderNotices };
}

// Guarded so another module can import diffTourImages above without
// also running this whole CLI body (which would otherwise
// parse process.argv, likely find nothing under a test runner, and
// process.exit(1) immediately).
// pathToFileURL (not a raw string comparison) so this is correct on
// Windows too, where a file URL needs an extra leading slash before the
// drive letter (file:///D:/...) that a naive `file://${path}` wouldn't add.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  await main();
}

async function main() {
  const [, , identifier] = process.argv;
  if (!identifier) {
    console.error('Usage: node scripts/syncTourImages.js <tourId|order|slug>');
    process.exit(1);
  }
  if (!config.photosRoot || !config.thumbnailsRoot) {
    console.error('PHOTOS_ROOT and THUMBNAILS_ROOT must both be set (see .env.example).');
    process.exit(1);
  }

  await mongoose.connect(config.db.testUri);

  let tour;
  if (mongoose.isValidObjectId(identifier)) {
    tour = await Tour.findById(identifier).select('+images +sourceFolder');
  } else if (/^\d+$/.test(identifier)) {
    tour = await Tour.findOne({ order: Number(identifier) }).select('+images +sourceFolder');
  } else {
    tour = await Tour.findOne({ slug: identifier }).select('+images +sourceFolder');
  }

  if (!tour) {
    console.error(`No tour found matching "${identifier}" (tried id, order, and slug).`);
    await mongoose.disconnect();
    process.exit(1);
  }

  if (!tour.sourceFolder) {
    console.error(
      `"${tour.title}" has no sourceFolder set yet - run scripts/matchTourFolders.js first (or set it by hand).`,
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  try {
    const { message, subfolderNotices } = await syncOneTour(tour);
    subfolderNotices.forEach((n) => console.log(n));
    console.log(message);
  } catch (err) {
    console.error(err.message);
    await mongoose.disconnect();
    process.exit(1);
  }

  await mongoose.disconnect();
}
