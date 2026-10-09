import fs from 'fs';
import path from 'path';
import config from '../config.js';
import MediaPhoto from '../models/mediaPhotoModel.js';
import { removeSizedFolder, removeSizedVersions } from './imageSizes.js';
import { isImageFile, processPhoto, thumbRelPath } from './imageFiles.js';

// Média → Fotók: every subfolder of MEDIA_PHOTOS_ROOT is a category, its
// photos are the category's photos - a new folder shows up as a new
// category by itself. A folder inside a category is an album of it (the
// carnivals' years): its photos are recorded as "<album>/<file>". Only one
// level - anything deeper is left alone. Thumbnails go to
// THUMBNAILS_ROOT/_media/<category>/, in the same subfolder.
export const mediaThumbDir = (category) => path.join(config.thumbnailsRoot, '_media', category);

// The NAS's own folders (@eaDir, #recycle) are not ours.
const subfolders = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('@') && !e.name.startsWith('#'))
    .map((e) => e.name);

const imagesIn = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && isImageFile(e.name))
    .map((e) => e.name);

// "2019/IMG_1.jpg" -> { album: '2019' }; a photo of the category itself has none.
const albumOf = (filename) =>
  filename.includes('/') ? { album: filename.slice(0, filename.indexOf('/')) } : {};

export async function syncMediaPhotos(sharp) {
  if (!config.mediaPhotosRoot) return [];
  const root = config.mediaPhotosRoot;
  const categories = subfolders(root);

  const results = [];
  for (const category of categories) {
    const dir = path.join(root, category);
    const files = [
      ...imagesIn(dir),
      ...subfolders(dir).flatMap((album) =>
        imagesIn(path.join(dir, album)).map((name) => `${album}/${name}`),
      ),
    ];
    const recorded = await MediaPhoto.find({ category }).select('filename');
    const known = new Set(recorded.map((p) => p.filename));
    const onDisk = new Set(files);

    let added = 0;
    let failures = 0;
    for (const filename of files.filter((f) => !known.has(f))) {
      try {
        const facts = await processPhoto(
          sharp,
          path.join(root, category, filename),
          path.join(mediaThumbDir(category), thumbRelPath(filename)),
        );
        await MediaPhoto.create({
          category,
          ...albumOf(filename),
          filename,
          ...facts,
          addedAt: new Date(),
        });
        added++;
      } catch {
        failures++;
      }
    }

    const gone = recorded.filter((p) => !onDisk.has(p.filename));
    for (const p of gone) {
      fs.rmSync(path.join(mediaThumbDir(category), thumbRelPath(p.filename)), { force: true });
    }
    removeSizedVersions(
      `media/${category}`,
      gone.map((p) => p.filename),
    );
    if (gone.length) await MediaPhoto.deleteMany({ _id: { $in: gone.map((p) => p._id) } });

    results.push({ title: category, added, removed: gone.length, total: files.length, failures });
  }

  // A whole category folder deleted or renamed: its records go too.
  const orphaned = await MediaPhoto.distinct('category', { category: { $nin: categories } });
  if (orphaned.length) await MediaPhoto.deleteMany({ category: { $in: orphaned } });
  for (const category of orphaned) removeSizedFolder(`media/${category}`);
  return results;
}
