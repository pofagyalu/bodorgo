// Fills in the sun's moments ("Az idő járása", tourModel.js's sunDays) of
// every tour - the pre('save') hook does it for a tour on its next save,
// this does them all at once (also the closed ones: it is worked out from
// their dates and place, nothing anyone typed). Straight into the
// database, no save hooks. Run once per database after the field arrived;
// running it again just writes the same times.
//
// Usage (the database is the DB_URI of the .env given - this folder's own
// by default, live's is S:/bodorgo/.env):
//   node scripts/fillSunDays.mjs [path/to/.env]            (dry run)
//   node scripts/fillSunDays.mjs [path/to/.env] --apply    (writes)

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Tour from '../src/models/tourModel.js';
import { computeSunDays } from '../src/utils/sunDays.js';

const envFile = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '.env';
const apply = process.argv.includes('--apply');
const { DB_URI } = dotenv.config({ path: envFile, quiet: true }).parsed ?? {};
if (!DB_URI) throw new Error(`No DB_URI in ${envFile}`);

await mongoose.connect(DB_URI);
console.log('Database:', mongoose.connection.db.databaseName);

const tours = await Tour.find().select('order title startDate duration location').lean();
let filled = 0;

for (const tour of tours.sort((a, b) => a.order - b.order)) {
  const sunDays = computeSunDays(tour);
  const first = sunDays[0];
  const time = (date) =>
    date?.toLocaleTimeString('hu-HU', { timeZone: 'Europe/Budapest', timeStyle: 'short' }) ?? '-';
  console.log(
    `${tour.order} ${tour.title}: ${sunDays.length} day(s)` +
      (first
        ? `, day 1 sunrise ${time(first.sunrise)} sunset ${time(first.sunset)} (Budapest time)`
        : ' - no place'),
  );
  if (apply) await Tour.updateOne({ _id: tour._id }, { $set: { sunDays } });
  if (sunDays.length) filled++;
}

console.log(`\n${apply ? 'Filled' : 'Would fill'} ${filled} of ${tours.length} tour(s).`);
if (!apply) console.log('This was a dry run - re-run with --apply to write them.');

await mongoose.disconnect();
process.exit(0);
