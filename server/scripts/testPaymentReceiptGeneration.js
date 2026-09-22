// Verifies generateReceiptPdf (see utils/paymentReceipt.js) produces a
// real, valid PDF with the expected deterministic filename - no DB,
// Stripe, or email involved, so this is safe to run any time.
//
// Usage:
//   node scripts/testPaymentReceiptGeneration.js

import fs from 'fs';
import path from 'path';
import { generateReceiptPdf, receiptFilenameFor, RECEIPTS_DIR } from '../src/utils/paymentReceipt.js';

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

const fakePayment = {
  _id: '507f1f77bcf86cd799439011',
  createdAt: new Date('2026-06-15T14:32:00'),
  amount: 15600,
  attendees: [
    { name: 'Nagy Lajos', amount: 7800 },
    { name: 'Nagy Réka', amount: 7800 },
  ],
};

const expectedFilename = receiptFilenameFor(fakePayment, 'Nagy Lajos');
check(
  'filename starts with date_time, then a slugified payer name, then the payment id',
  expectedFilename === '2026-06-15_1432_nagy-lajos_507f1f77bcf86cd799439011.pdf',
);

let filename;
try {
  filename = await generateReceiptPdf(fakePayment, 'Nagy Lajos', 'Szilvásvárad - Szalajkavölgy', new Date('2026-07-10'));
  check('generateReceiptPdf returns the same deterministic filename', filename === expectedFilename);

  const filePath = path.join(RECEIPTS_DIR, filename);
  check('the PDF file actually exists on disk', fs.existsSync(filePath));

  const bytes = fs.readFileSync(filePath);
  check('output starts with the %PDF magic header', bytes.subarray(0, 4).toString() === '%PDF');
  check('output ends with %%EOF (a complete, valid PDF trailer)', bytes.subarray(-6).toString().includes('%%EOF'));
  check('output is a substantial file, not an empty/broken stub', bytes.length > 500);
} finally {
  if (filename) {
    fs.rmSync(path.join(RECEIPTS_DIR, filename), { force: true });
    console.log('\nCleaned up the test receipt PDF.');
  }
}

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');
