// Verifies tourImageController.js against real synced data (tour order 2,
// "Tamási szarvasnéző", 62 photos - see scripts/syncTourImages.js) by
// calling the real exported controller functions directly with fake
// req/res, same approach as testSignUpForTour.js. Covers: the list
// endpoint, a normal thumbnail, the thumb-missing fallback to the full
// image, a rejected unknown filename, and that the zip stream produces a
// real zip (PK magic bytes) covering every recorded photo.
//
// Read-only against the DB and disk - doesn't create/delete anything, so
// there's nothing to clean up. Safe to re-run any time.
//
// Usage:
//   node scripts/testTourImageController.js

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Writable } from 'stream';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import {
  getTourImages,
  getTourImageThumb,
  getTourImage,
  downloadTourImagesZip,
} from '../src/controllers/tourImageController.js';

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    sentFile: null,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    sendFile(p) {
      this.sentFile = p;
    },
  };
}

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

await mongoose.connect(config.db.testUri);

const tour = await Tour.findOne({ order: 2 }).select('+images +sourceFolder');
if (!tour || tour.images.length === 0) {
  console.error('Tour order 2 has no synced images - run scripts/syncTourImages.js 2 first.');
  process.exit(1);
}
const tourId = tour._id.toString();
const knownFilename = tour.images[0].filename;

// GET /tours/:tourId/images
const listRes = fakeRes();
await getTourImages({ params: { tourId } }, listRes);
check('getTourImages returns the full recorded list', listRes.body?.data?.images?.length === tour.images.length);
check(
  'getTourImages list starts with the expected filename',
  listRes.body?.data?.images?.[0]?.filename === knownFilename,
);
check(
  'getTourImages includes real width/height for PhotoSwipe',
  listRes.body?.data?.images?.[0]?.width > 0 && listRes.body?.data?.images?.[0]?.height > 0,
);
check(
  'getTourImages includes real file size for the zip-size tooltip',
  listRes.body?.data?.images?.[0]?.size > 0,
);

// GET /tours/:tourId/images/:filename/thumb - normal case, thumbnail exists
const thumbRes = fakeRes();
await getTourImageThumb({ params: { tourId, filename: knownFilename } }, thumbRes);
check(
  'getTourImageThumb serves the pre-generated .webp when it exists',
  thumbRes.sentFile?.endsWith('.webp') && fs.existsSync(thumbRes.sentFile),
);

// GET /tours/:tourId/images/:filename/thumb - fallback when no thumbnail exists
const thumbPath = path.resolve(
  config.thumbnailsRoot,
  tour.sourceFolder,
  `${path.parse(knownFilename).name}.webp`,
);
const thumbBackup = `${thumbPath}.testbackup`;
fs.renameSync(thumbPath, thumbBackup);
try {
  const fallbackRes = fakeRes();
  await getTourImageThumb({ params: { tourId, filename: knownFilename } }, fallbackRes);
  check(
    'getTourImageThumb falls back to the full image when the thumbnail is missing',
    fallbackRes.sentFile?.endsWith(knownFilename),
  );
} finally {
  fs.renameSync(thumbBackup, thumbPath); // restore regardless of pass/fail
}

// GET /tours/:tourId/images/:filename - full image
const fullRes = fakeRes();
await getTourImage({ params: { tourId, filename: knownFilename } }, fullRes);
check('getTourImage serves the full-resolution original', fullRes.sentFile?.endsWith(knownFilename));

// An id/filename combination that was never recorded must be rejected,
// not silently served or crash.
let unknownError = null;
try {
  await getTourImage({ params: { tourId, filename: 'not-a-real-file.jpg' } }, fakeRes());
} catch (err) {
  unknownError = err;
}
check(
  'a filename not in this tour\'s recorded list is rejected',
  !!unknownError && /Nincs ilyen fénykép/.test(unknownError.message),
);

// GET /tours/:tourId/images/download-zip - collect the piped stream into a
// buffer and check it's a real zip covering every photo.
const chunks = [];
const collector = new Writable({
  write(chunk, _enc, cb) {
    chunks.push(chunk);
    cb();
  },
});
collector.headersSent = false;
collector.attachment = () => {}; // res.attachment() is a no-op on this fake
const zipDone = new Promise((resolve) => collector.on('finish', resolve));
await downloadTourImagesZip({ params: { tourId } }, collector);
await zipDone;
const zipBuffer = Buffer.concat(chunks);
check('zip download produces a real zip (PK magic bytes)', zipBuffer.subarray(0, 2).toString() === 'PK');
check('zip download is a substantial size for 62 real photos', zipBuffer.length > 1_000_000);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');

await mongoose.disconnect();
