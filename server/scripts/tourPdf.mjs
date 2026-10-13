// A tour's Programfüzet as an admin gets it (GET /tours/:id/pdf - see
// tourPdfController.js), written to a file - to look at it (with
// pdfToPng.mjs).
//
//   node scripts/tourPdf.mjs <tour id, slug or number> <out.pdf>
//
// It works on the database DB_URI points at - the local dev one from .env.
import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';
import Tour from '../src/models/tourModel.js';
import User from '../src/models/userModel.js';
import { downloadTourPdf } from '../src/controllers/tourPdfController.js';

const [which, out] = process.argv.slice(2);
if (!which || !out) {
  console.error('Usage: tourPdf.mjs <tour id, slug or number> <out.pdf>');
  process.exit(1);
}

await mongoose.connect(process.env.DB_URI);
try {
  const tour = /^\d+$/.test(which)
    ? await Tour.findOne({ order: Number(which) })
    : await Tour.findOne(mongoose.isValidObjectId(which) ? { _id: which } : { slug: which });
  if (!tour) throw new Error(`No such tour: ${which}`);
  // Each copy carries its downloader's name - an admin's here.
  const user = await User.findOne({ role: 'admin' });

  const file = fs.createWriteStream(out);
  file.setHeader = () => {};
  const written = new Promise((resolve) => file.on('finish', resolve));
  await downloadTourPdf({ params: { id: String(tour._id) }, query: {}, user }, file);
  await written;
  console.log(out);
} finally {
  await mongoose.disconnect();
}
