// A tour's beszámoló as the JSON an AI model gets (the same as GET
// /tours/:id/report/json - see tourReportJsonController.js), to look at it.
//
//   node scripts/reportJson.mjs <tour id, slug or number> [out.json] [--final]
//
// The working copy as it is now by default; --final: the finished (Kész)
// one. It works on the database DB_URI points at - the local dev one from
// .env. People who have no alias yet get one (written to that database).
import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';
import Tour from '../src/models/tourModel.js';
import { getReportJson } from '../src/controllers/tourReportJsonController.js';

const args = process.argv.slice(2).filter((a) => a !== '--final');
const [which, out] = args;
if (!which) {
  console.error('Usage: reportJson.mjs <tour id, slug or number> [out.json] [--final]');
  process.exit(1);
}

await mongoose.connect(process.env.DB_URI);
try {
  const tour = /^\d+$/.test(which)
    ? await Tour.findOne({ order: Number(which) })
    : await Tour.findOne(mongoose.isValidObjectId(which) ? { _id: which } : { slug: which });
  if (!tour) throw new Error(`No such tour: ${which}`);

  let body;
  const res = { status: () => res, json: (b) => (body = b) };
  await getReportJson(
    {
      params: { id: String(tour._id) },
      query: { draft: process.argv.includes('--final') ? '' : '1' },
    },
    res,
  );
  const json = JSON.stringify(body.data, null, 2);
  if (out) {
    fs.writeFileSync(out, json);
    console.log(`${out}: ${body.data.chunks.length} chunks`);
  } else {
    console.log(json);
  }
} finally {
  await mongoose.disconnect();
}
