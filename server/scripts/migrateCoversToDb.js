// One-off: copies every tour's existing cover JPEG from the NAS's
// public/img/tours/ (the old, publicly served location - see the old
// imageCover field) into the TourCover collection, and sets the tour's
// coverUpdatedAt so the client starts asking the new login-only
// GET /tours/:id/cover route for it. Only ever adds data: the files on the
// NAS and the old imageCover values are left untouched, so the old server
// keeps working until the new one is deployed. Safe to run again - an
// already-imported cover is just overwritten with the same bytes.
//
// Reads the NAS copy (S:/bodorgo/public/img/tours, reached the same way
// sync.js reaches the deploy target) since that's the real, complete set;
// falls back to this repo's local public/img/tours for anything missing.
// Uses THIS dev machine's DB_URI - which is the same database production
// uses (see the shared-database note in the root README).
//
// Usage (from server/): node scripts/migrateCoversToDb.js
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import TourCover from '../src/models/tourCoverModel.js';

const NAS_DIR = 'S:/bodorgo/public/img/tours';
const LOCAL_DIR = path.resolve('public/img/tours');

function detectType(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  return null;
}

await mongoose.connect(process.env.DB_URI);
// The raw collection, not the Tour model: imageCover is no longer part of
// the schema, but it's still in the stored documents and is what says
// which file belongs to which tour.
const tours = mongoose.connection.db.collection('tours');
const list = await tours
  .find(
    { imageCover: { $exists: true, $ne: '' } },
    { projection: { order: 1, title: 1, imageCover: 1 } },
  )
  .sort({ order: 1 })
  .toArray();

let imported = 0;
for (const tour of list) {
  const candidates = [path.join(NAS_DIR, tour.imageCover), path.join(LOCAL_DIR, tour.imageCover)];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) {
    console.log(`✘ ${tour.order}. ${tour.title}: ${tour.imageCover} not found`);
    continue;
  }
  const data = fs.readFileSync(file);
  const contentType = detectType(data);
  if (!contentType) {
    console.log(`✘ ${tour.order}. ${tour.title}: ${tour.imageCover} is not a JPEG/PNG`);
    continue;
  }

  await TourCover.findOneAndUpdate({ tour: tour._id }, { data, contentType }, { upsert: true });
  await tours.updateOne({ _id: tour._id }, { $set: { coverUpdatedAt: fs.statSync(file).mtime } });
  imported += 1;
  console.log(
    `✓ ${tour.order}. ${tour.title}: ${tour.imageCover} (${Math.round(data.length / 1024)} KB)`,
  );
}

console.log(`\n${imported}/${list.length} covers imported.`);
await mongoose.disconnect();
