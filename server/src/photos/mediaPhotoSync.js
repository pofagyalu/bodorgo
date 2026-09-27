import fs from 'fs';
import path from 'path';
import config from '../config.js';
import MediaPhoto from '../models/mediaPhotoModel.js';
import { isImageFile, processPhoto, thumbRelPath } from './imageFiles.js';

// Média → Fotók: every subfolder of MEDIA_PHOTOS_ROOT is a category, its
// photos are the category's photos - a new folder shows up as a new
// category by itself. Thumbnails go to THUMBNAILS_ROOT/_media/<category>/.
export const mediaThumbDir = (category) => path.join(config.thumbnailsRoot, '_media', category);

export async function syncMediaPhotos(sharp) {
  if (!config.mediaPhotosRoot) return [];
  const root = config.mediaPhotosRoot;
  const categories = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('@') && !e.name.startsWith('#'))
    .map((e) => e.name);

  const results = [];
  for (const category of categories) {
    const files = fs
      .readdirSync(path.join(root, category), { withFileTypes: true })
      .filter((e) => e.isFile() && isImageFile(e.name))
      .map((e) => e.name);
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
        await MediaPhoto.create({ category, filename, ...facts });
        added++;
      } catch {
        failures++;
      }
    }

    const gone = recorded.filter((p) => !onDisk.has(p.filename));
    for (const p of gone) {
      fs.rmSync(path.join(mediaThumbDir(category), thumbRelPath(p.filename)), { force: true });
    }
    if (gone.length) await MediaPhoto.deleteMany({ _id: { $in: gone.map((p) => p._id) } });

    results.push({ title: category, added, removed: gone.length, total: files.length, failures });
  }

  // A whole category folder deleted or renamed: its records go too.
  const orphaned = await MediaPhoto.distinct('category', { category: { $nin: categories } });
  if (orphaned.length) await MediaPhoto.deleteMany({ category: { $in: orphaned } });
  return results;
}
