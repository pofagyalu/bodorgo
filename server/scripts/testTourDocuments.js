// Verifies uploadTourDocument/deleteTourDocument's actual logic (max-5
// enforcement, title validation, orphaned-file cleanup on rejection,
// filename-carries-tour-identity convention, deletion removing both the
// DB entry and the file on disk) against a real tour. Multer's own
// multipart parsing isn't re-tested here (it's a well-established
// library) - req.file is constructed by hand the same shape multer
// would produce, same as other scripts in this session fake req/res.
//
// Snapshots and restores tour order 2's extraDocuments - safe to re-run.
//
// Usage:
//   node scripts/testTourDocuments.js

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import { uploadTourDocument, deleteTourDocument } from '../src/controllers/tourDocumentController.js';

const DOCS_ROOT = path.join(path.resolve(), 'public', 'documents', 'tours');

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

// A real (tiny, valid) PDF, so fs operations on it behave like a genuine upload.
const FAKE_PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

function makeFakeUploadedFile(tourId, tourOrder, tourSlug, ext = '.pdf', mimetype = 'application/pdf') {
  const dir = path.join(DOCS_ROOT, String(tourId));
  fs.mkdirSync(dir, { recursive: true });
  const filename = `tour-${tourOrder}-${tourSlug}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}${ext}`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, FAKE_PDF_BYTES);
  return { path: filePath, filename, mimetype, originalname: `original${ext}` };
}

await mongoose.connect(config.db.testUri);

const tour = await Tour.findOne({ order: 2 });
if (!tour) {
  console.error('Tour order 2 not found - cannot run this check.');
  process.exit(1);
}

const originalDocs = tour.extraDocuments.map((d) => d.toObject());

try {
  // Clear to a known state for this test.
  tour.extraDocuments = [];
  await tour.save();

  // --- Successful upload ---
  {
    const file = makeFakeUploadedFile(tour._id, tour.order, tour.slug);
    const req = { tour, body: { title: 'Térkép' }, file };
    const res = fakeRes();
    await uploadTourDocument(req, res);

    check('upload succeeds with 201', res.statusCode === 201);
    const fresh = await Tour.findById(tour._id);
    check('extraDocuments now has one entry', fresh.extraDocuments.length === 1);
    check('stored filename embeds the tour order and slug', fresh.extraDocuments[0].filename.startsWith(`tour-${tour.order}-${tour.slug}-`));
    check('file actually exists on disk', fs.existsSync(path.join(DOCS_ROOT, String(tour._id), fresh.extraDocuments[0].filename)));
    check('title/mimeType saved correctly', fresh.extraDocuments[0].title === 'Térkép' && fresh.extraDocuments[0].mimeType === 'application/pdf');
  }

  // --- Missing title is rejected, and the orphaned upload is cleaned up ---
  {
    const file = makeFakeUploadedFile(tour._id, tour.order, tour.slug);
    const req = { tour: await Tour.findById(tour._id), body: { title: '  ' }, file };
    const res = fakeRes();
    let threw = false;
    try {
      await uploadTourDocument(req, res);
    } catch {
      threw = true;
    }
    check('a blank title is rejected', threw);
    check('the rejected file was cleaned up off disk, not left orphaned', !fs.existsSync(file.path));
  }

  // --- Filling up to 5 works, a 6th is rejected and cleaned up ---
  {
    let current = await Tour.findById(tour._id);
    for (let i = 0; i < 4; i++) {
      const file = makeFakeUploadedFile(current._id, current.order, current.slug);
      await uploadTourDocument({ tour: current, body: { title: `Doksi ${i}` }, file }, fakeRes());
      current = await Tour.findById(tour._id);
    }
    check('now at exactly 5 documents (1 from before + 4 more)', current.extraDocuments.length === 5);

    const sixthFile = makeFakeUploadedFile(current._id, current.order, current.slug);
    let threw = false;
    try {
      await uploadTourDocument({ tour: current, body: { title: 'Hatodik' }, file: sixthFile }, fakeRes());
    } catch {
      threw = true;
    }
    check('a 6th document is rejected (max 5 enforced)', threw);
    check('the rejected 6th file was cleaned up off disk', !fs.existsSync(sixthFile.path));
    const afterRejection = await Tour.findById(tour._id);
    check('still exactly 5 documents after the rejected attempt', afterRejection.extraDocuments.length === 5);
  }

  // --- Deletion removes both the DB entry and the file on disk ---
  {
    const before = await Tour.findById(tour._id);
    const target = before.extraDocuments[0];
    const targetPath = path.join(DOCS_ROOT, String(tour._id), target.filename);
    check('the file to be deleted exists beforehand', fs.existsSync(targetPath));

    const req = { params: { tourId: String(tour._id), documentId: String(target._id) } };
    const res = fakeRes();
    await deleteTourDocument(req, res);

    check('delete responds with 204', res.statusCode === 204);
    const after = await Tour.findById(tour._id);
    check('extraDocuments count decreased by one', after.extraDocuments.length === before.extraDocuments.length - 1);
    check('the deleted entry is really gone from the array', !after.extraDocuments.some((d) => String(d._id) === String(target._id)));
    check('the file itself was removed from disk', !fs.existsSync(targetPath));
  }
} finally {
  // Clean up every file this test created, then restore the original array.
  // Re-fetched fresh rather than reusing the `tour` variable from the top
  // of the script - it's since been saved many times over via separate
  // Tour.findById() copies (each upload/delete step above intentionally
  // re-fetches to see the other steps' effects), so its in-memory version
  // number is now stale and would fail Mongoose's optimistic-concurrency
  // check on save.
  const finalDir = path.join(DOCS_ROOT, String(tour._id));
  if (fs.existsSync(finalDir)) fs.rmSync(finalDir, { recursive: true, force: true });
  const freshTour = await Tour.findById(tour._id);
  freshTour.extraDocuments = originalDocs;
  await freshTour.save();
  console.log('\nRestored tour order 2 to its original extraDocuments and cleaned up test files.');
}

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');

await mongoose.disconnect();
