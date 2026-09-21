// One-off migration: converts every tour's .webp cover image to .jpg and
// updates the Tour document's imageCover field to match. Motivated by a
// real production bug - the deployed server has no working `sharp` (its
// native binary can't be shipped from this Windows dev machine to the
// Linux NAS - see tourPdfController.js/build.js), so the Programfüzet PDF
// silently drops the cover photo entirely for any .webp cover. pdfkit can
// embed JPEG/PNG directly with no image-processing library at all, so
// converting removes the dependency on sharp working in production for
// this to render.
//
// Operates directly on the NAS's live files/DB - dev and prod share the
// same MongoDB (see config.js's db.uri/testUri), but public/img/tours/ is
// per-environment and NOT git-synced, so this only writes the new .jpg
// files to the NAS side (TOURS_IMG_DIR below). The local dev copy under
// server/public/img/tours/ (which does have its own real files, just the
// old .webp ones) needs those new .jpg files copied down separately, or
// the DB's now-updated imageCover pointing at a filename that only exists
// on the NAS breaks cover images on localhost - a real bug this caused
// the first time this script ran, fixed by hand that once by copying
// S:/bodorgo/public/img/tours/*.jpg into the local folder. Uses THIS dev
// machine's own (Windows) sharp only for the one-time conversion, not the
// deployed server, since local sharp works fine here - the deploy-time
// problem is specifically about shipping a Linux binary from this
// machine.
//
// Old .webp files are left in place (not deleted) - safe to re-run, and
// easy to roll back by hand if a converted photo looks wrong.
//
// Usage:
//   node scripts/convertCoverImagesToJpeg.js

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';

// The NAS's real public/img/tours, reached the same way sync.js reaches
// S:\bodorgo - a mapped network drive, not this repo's own gitignored
// (and here, empty) server/public/.
const TOURS_IMG_DIR = 'S:/bodorgo/public/img/tours';

await mongoose.connect(config.db.uri);

const tours = await Tour.find({ imageCover: /\.webp$/i }).select('order title imageCover');

if (tours.length === 0) {
  console.log('No tours with a .webp cover image found - nothing to do.');
  await mongoose.disconnect();
  process.exit(0);
}

console.log(`Found ${tours.length} tour(s) with a .webp cover to convert:\n`);

let converted = 0;
let failed = 0;

for (const tour of tours) {
  const oldFilename = tour.imageCover;
  const newFilename = oldFilename.replace(/\.webp$/i, '.jpg');
  const oldPath = path.join(TOURS_IMG_DIR, oldFilename);
  const newPath = path.join(TOURS_IMG_DIR, newFilename);

  if (!fs.existsSync(oldPath)) {
    console.error(`✗ Tour ${tour.order} (${tour.title}): source file not found at ${oldPath}`);
    failed++;
    continue;
  }

  try {
    await sharp(oldPath).jpeg({ quality: 85 }).toFile(newPath);
    tour.imageCover = newFilename;
    await tour.save();
    console.log(`✓ Tour ${tour.order} (${tour.title}): ${oldFilename} → ${newFilename}`);
    converted++;
  } catch (err) {
    console.error(`✗ Tour ${tour.order} (${tour.title}): conversion failed - ${err.message}`);
    failed++;
  }
}

console.log(`\n${converted} converted, ${failed} failed. Old .webp files were left in place.`);

await mongoose.disconnect();

if (failed > 0) process.exit(1);
