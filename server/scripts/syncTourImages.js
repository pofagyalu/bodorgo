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
import { pathToFileURL } from 'url';
import mongoose from 'mongoose';
import sharp from 'sharp';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import { diffTourImages, syncTourPhotos } from '../src/photos/tourPhotoSync.js';

// The sync itself lives in the server (src/photos/tourPhotoSync.js) - the
// admins' "Új média felfedezése" button runs the same code for every tour.
export { diffTourImages };

export async function syncOneTour(tour) {
  const r = await syncTourPhotos(tour, sharp);
  const failures = r.failures ? `, ${r.failures} failure(s)` : '';
  return {
    message: `"${r.title}": added ${r.added} new photo(s), removed ${r.removed} (${r.total} total)${failures}.`,
    subfolderNotices: r.skipped.map((d) => `Note: subfolder ${d} was not read (only "mobil" is).`),
  };
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

  await mongoose.connect(config.db.uri);

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
