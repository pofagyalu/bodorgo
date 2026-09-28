// Temporary CLI utility for filling in a tour's day-by-day schedule before
// there's an admin UI for it (only admins will add/edit events on the page
// itself eventually - see tour-details.ts on the client for how they're
// rendered, and tourModel.js for the schedule field itself).
//
// Usage:
//   node scripts/addSchedule.js <tourId> <path-to-events.json>
//
// events.json is an array of { day, time, description } objects, e.g.:
// [
//   { "day": 1, "time": "09:00", "description": "Indulás Budapestről" },
//   { "day": 1, "time": "12:00", "description": "Ebéd a Rákóczi várnál" },
//   { "day": 2, "time": "08:30", "description": "Túra a Megyer-hegyi tengerszemhez" }
// ]
//
// day is 1-indexed (1 = the tour's startDate). Appends to whatever
// schedule the tour already has - run it again with more entries any time,
// nothing gets overwritten or duplicated away.

import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';

const [, , tourId, filePath] = process.argv;

if (!tourId || !filePath) {
  console.error('Usage: node scripts/addSchedule.js <tourId> <path-to-events.json>');
  process.exit(1);
}

const entries = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

if (!Array.isArray(entries) || entries.length === 0) {
  console.error('events.json must be a non-empty array of { day, time, description }');
  process.exit(1);
}

await mongoose.connect(config.db.uri);

const tour = await Tour.findById(tourId);
if (!tour) {
  console.error(`No tour found with id ${tourId}`);
  await mongoose.disconnect();
  process.exit(1);
}

tour.schedule.push(...entries);
await tour.save();

console.log(
  `Added ${entries.length} event(s) to "${tour.title}". Schedule now has ${tour.schedule.length} total.`,
);

await mongoose.disconnect();
