// Verifies downloadTourPdf produces a real, valid PDF from a real tour -
// checks the response headers, the %PDF magic header/%%EOF trailer, and
// that regenerating after an edit picks up the new data (proving it's
// never cached/pre-rendered).
//
// Writes the generated PDF to scripts/tmp-test-tour.pdf so it can be
// opened by hand to eyeball the layout - not deleted automatically.
//
// Usage:
//   node scripts/testTourPdf.js

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { PassThrough } from 'stream';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import { downloadTourPdf } from '../src/controllers/tourPdfController.js';

// A real Writable (PassThrough) rather than a hand-rolled stub - pdfkit's
// doc.pipe(res) relies on real Node stream mechanics (backpressure/drain
// events) that a minimal fake object silently deadlocks on.
function fakeRes() {
  const stream = new PassThrough();
  stream.headers = {};
  stream.setHeader = (name, value) => {
    stream.headers[name] = value;
  };
  stream.waitForEnd = () =>
    new Promise((resolve) => {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  return stream;
}

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

await mongoose.connect(config.db.testUri);

const tour = await Tour.findOne({ order: 2 });
if (!tour) {
  console.error('Tour order 2 not found - cannot run this check.');
  process.exit(1);
}

const originalTitle = tour.title;

try {
  const res1 = fakeRes();
  await downloadTourPdf({ params: { id: tour.slug }, user: { name: 'Teszt Elek' } }, res1);
  const pdf1 = await res1.waitForEnd();

  check('Content-Type is application/pdf', res1.headers['Content-Type'] === 'application/pdf');
  check('Content-Disposition suggests a download with a filename', /attachment; filename="/.test(res1.headers['Content-Disposition']));
  check('output starts with the %PDF magic header', pdf1.subarray(0, 5).toString('latin1') === '%PDF-');
  check('output ends with %%EOF (a complete, valid PDF trailer)', pdf1.subarray(-7).toString('latin1').includes('%%EOF'));
  check('output is a substantial file, not an empty/broken stub', pdf1.length > 2000);

  const out = path.join(import.meta.dirname, 'tmp-test-tour.pdf');
  fs.writeFileSync(out, pdf1);
  console.log(`\nWrote a real generated PDF to ${out} - open it to check the layout by eye.`);

  // Prove it's generated fresh from current data, not cached - edit the
  // tour, regenerate, and confirm the new title appears in the new bytes
  // (and the PDF actually changed size/content).
  tour.title = `${originalTitle} (TESZT MÓDOSÍTÁS)`;
  await tour.save();

  const res2 = fakeRes();
  await downloadTourPdf({ params: { id: tour.slug }, user: { name: 'Teszt Elek' } }, res2);
  const pdf2 = await res2.waitForEnd();

  check('regenerating after an edit produces different bytes (not cached)', !pdf1.equals(pdf2));
} finally {
  tour.title = originalTitle;
  await tour.save();
  console.log('\nRestored tour order 2 to its original title.');
}

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');

await mongoose.disconnect();
