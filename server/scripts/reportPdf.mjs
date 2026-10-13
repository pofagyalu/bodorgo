// A tour's beszámoló PDF as an admin gets it (GET /tours/:id/report/pdf -
// see tourReportController.js), written to a file - to look at it (with
// pdfToPng.mjs).
//
//   node scripts/reportPdf.mjs <tour id, slug or number> <out.pdf> [--final]
//
// The working copy (PISZKOZAT across it) by default; --final: the finished
// (Kész) one. It works on the database DB_URI points at - the local dev
// one from .env.
import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';
import Tour from '../src/models/tourModel.js';
import { downloadReportPdf } from '../src/controllers/tourReportController.js';

const [which, out] = process.argv.slice(2).filter((a) => a !== '--final');
if (!which || !out) {
  console.error('Usage: reportPdf.mjs <tour id, slug or number> <out.pdf> [--final]');
  process.exit(1);
}

await mongoose.connect(process.env.DB_URI);
try {
  const tour = /^\d+$/.test(which)
    ? await Tour.findOne({ order: Number(which) })
    : await Tour.findOne(mongoose.isValidObjectId(which) ? { _id: which } : { slug: which });
  if (!tour) throw new Error(`No such tour: ${which}`);

  const file = fs.createWriteStream(out);
  file.setHeader = () => {};
  const written = new Promise((resolve) => file.on('finish', resolve));
  await downloadReportPdf(
    {
      params: { id: String(tour._id) },
      query: { draft: process.argv.includes('--final') ? '' : '1' },
      user: { role: 'admin' },
    },
    file,
  );
  await written;
  console.log(out);
} finally {
  await mongoose.disconnect();
}
