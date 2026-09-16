// Reads a tour's photo folder (PHOTOS_ROOT/<tour.sourceFolder>/, see
// matchTourFolders.js for how sourceFolder gets set) and appends any image
// file not already recorded in tour.images - never reorders or removes
// existing entries, so an already-recorded photo (and its thumbnail) keeps
// its position across re-syncs, even as new photos get added to the folder
// later. Also generates a small .webp thumbnail per newly-added photo via
// sharp, written to THUMBNAILS_ROOT/<sourceFolder>/ - sharp only ever runs
// here, never inside the bundled server (see
// tour-photos-implementation-plan.md for why that split matters).
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
import mongoose from 'mongoose';
import sharp from 'sharp';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic']);
const THUMB_WIDTH = 400;

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

const folderPath = path.join(config.photosRoot, tour.sourceFolder);
if (!fs.existsSync(folderPath)) {
  console.error(`Folder not found: ${folderPath}`);
  await mongoose.disconnect();
  process.exit(1);
}

const entries = fs.readdirSync(folderPath, { withFileTypes: true });

for (const sub of entries.filter((e) => e.isDirectory())) {
  const count = fs.readdirSync(path.join(folderPath, sub.name)).length;
  if (count > 0) {
    console.log(
      `Note: subfolder "${sub.name}" (${count} file(s)) was not read - subfolders aren't walked yet, see the plan.`,
    );
  }
}

const files = entries
  .filter((e) => e.isFile() && IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
  .map((e) => e.name)
  .sort((a, b) => a.localeCompare(b));

const existing = new Set(tour.images.map((i) => i.filename));
const newFiles = files.filter((f) => !existing.has(f));

if (newFiles.length === 0) {
  console.log(`"${tour.title}": no new photos found (${tour.images.length} already recorded).`);
  await mongoose.disconnect();
  process.exit(0);
}

const thumbDir = path.join(config.thumbnailsRoot, tour.sourceFolder);
fs.mkdirSync(thumbDir, { recursive: true });

let thumbsGenerated = 0;
let thumbFailures = 0;
const added = [];
for (const filename of newFiles) {
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

tour.images.push(...added);
await tour.save();

console.log(
  `"${tour.title}": added ${added.length} new photo(s) (${tour.images.length} total), generated ${thumbsGenerated} thumbnail(s)${
    thumbFailures ? `, ${thumbFailures} failure(s)` : ''
  }.`,
);

await mongoose.disconnect();
