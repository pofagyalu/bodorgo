// Verifies uploadTourCover's actual logic (deterministic tour-<order>-
// cover.<ext> naming, replacing rather than piling up, and cleaning up
// the old file when the extension changes) against a throwaway tour -
// never touches a real tour's own cover image/file. req.file is
// constructed by hand the same shape multer would produce, same as other
// scripts in this session fake req/res (multer's own multipart parsing
// isn't re-tested here, it's a well-established library).
//
// Creates and deletes its own tour (order 9989, distinct from
// testTourCreateUpdate.js's 9990) - safe to re-run.
//
// Usage:
//   node scripts/testTourCoverUpload.js

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import { uploadTourCover, uploadCoverForOrder } from '../src/controllers/tourCoverController.js';

const TOURS_IMG_DIR = path.join(path.resolve(), 'public', 'img', 'tours');
const TEST_ORDER = 9989;

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

// A real (tiny, valid) JPEG, so fs operations on it behave like a genuine upload.
const FAKE_JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const FAKE_PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makeFakeUploadedFile(filename, bytes, mimetype) {
  const filePath = path.join(TOURS_IMG_DIR, filename);
  fs.writeFileSync(filePath, bytes);
  return { filename, path: filePath, mimetype, originalname: 'whatever-the-admin-named-it.jpg' };
}

await mongoose.connect(config.db.testUri);

await Tour.deleteOne({ order: TEST_ORDER }); // clean slate if a previous run left one behind

const tour = await Tour.create({
  order: TEST_ORDER,
  title: 'ZZ Test Tour (cover upload)',
  location: { description: 'Teszt', address: 'Teszt utca 1.', coordinates: [19, 47] },
  startDate: new Date('2030-01-01'),
  duration: 3,
  maxCapacity: 10,
  summary: 'Teszt',
  description: 'Teszt tábor a cover upload teszteléséhez.',
  // Required by the schema - a placeholder, real-looking filename that
  // doesn't need to exist on disk (nothing in this test reads it before
  // the first real upload replaces it).
  imageCover: `tour-${TEST_ORDER}-cover.jpg`,
});

try {
  // --- First upload (jpg) ---
  {
    const filename = `tour-${TEST_ORDER}-cover.jpg`;
    const file = makeFakeUploadedFile(filename, FAKE_JPEG_BYTES, 'image/jpeg');
    const req = { tour, file };
    const res = fakeRes();
    await uploadTourCover(req, res);

    check('upload succeeds with 200', res.statusCode === 200);
    const fresh = await Tour.findById(tour._id);
    check('imageCover set to the deterministic filename', fresh.imageCover === filename);
    check('file actually exists on disk', fs.existsSync(path.join(TOURS_IMG_DIR, filename)));
  }

  // --- Second upload, same extension - should just overwrite, no orphan ---
  {
    const filename = `tour-${TEST_ORDER}-cover.jpg`;
    const file = makeFakeUploadedFile(filename, FAKE_JPEG_BYTES, 'image/jpeg');
    const fresh = await Tour.findById(tour._id);
    const req = { tour: fresh, file };
    const res = fakeRes();
    await uploadTourCover(req, res);

    check('re-upload with the same extension succeeds', res.statusCode === 200);
    const afterSecond = await Tour.findById(tour._id);
    check('imageCover unchanged (same filename)', afterSecond.imageCover === filename);
  }

  // --- Third upload, different extension (png) - old .jpg should be removed ---
  {
    const oldPath = path.join(TOURS_IMG_DIR, `tour-${TEST_ORDER}-cover.jpg`);
    check('the old .jpg exists before the png upload', fs.existsSync(oldPath));

    const newFilename = `tour-${TEST_ORDER}-cover.png`;
    const file = makeFakeUploadedFile(newFilename, FAKE_PNG_BYTES, 'image/png');
    const fresh = await Tour.findById(tour._id);
    const req = { tour: fresh, file };
    const res = fakeRes();
    await uploadTourCover(req, res);

    check('png upload succeeds', res.statusCode === 200);
    const afterThird = await Tour.findById(tour._id);
    check('imageCover switched to the new .png filename', afterThird.imageCover === newFilename);
    check('the new .png file exists on disk', fs.existsSync(path.join(TOURS_IMG_DIR, newFilename)));
    check('the old .jpg was cleaned up (no orphan left behind)', !fs.existsSync(oldPath));
  }
  // --- uploadCoverForOrder - the pre-creation path, no Tour involved at
  // all, just reports back the deterministic filename it saved to. ---
  {
    const PRE_CREATE_ORDER = 9988;
    const filename = `tour-${PRE_CREATE_ORDER}-cover.jpg`;
    const file = makeFakeUploadedFile(filename, FAKE_JPEG_BYTES, 'image/jpeg');
    const req = { params: { order: String(PRE_CREATE_ORDER) }, file };
    const res = fakeRes();
    try {
      await uploadCoverForOrder(req, res);
      check('pre-creation upload succeeds with 200', res.statusCode === 200);
      check('reports back the deterministic filename', res.body?.data?.filename === filename);
      check('the file actually exists on disk', fs.existsSync(path.join(TOURS_IMG_DIR, filename)));
    } finally {
      fs.rmSync(path.join(TOURS_IMG_DIR, filename), { force: true });
    }
  }
} finally {
  fs.rmSync(path.join(TOURS_IMG_DIR, `tour-${TEST_ORDER}-cover.jpg`), { force: true });
  fs.rmSync(path.join(TOURS_IMG_DIR, `tour-${TEST_ORDER}-cover.png`), { force: true });
  await Tour.deleteOne({ order: TEST_ORDER });
  console.log('\nCleaned up the throwaway test tour and its test files.');
}

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');

await mongoose.disconnect();
