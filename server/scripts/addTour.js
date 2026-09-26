// Temporary CLI utility for creating a new tour before there's an admin UI
// for it - pass 1 of the three-pass workflow for adding a tour:
//   1. this script - the tour itself
//   2. scripts/addSchedule.js - day-by-day events
//   3. dev-data/data/create-reservation.js - participants
//
// Usage:
//   node scripts/addTour.js <path-to-tour.json>
//
// tour.json shape (matches dev-data/data/tours-simple.json's per-tour
// format). Required fields per the schema: title, startDate, duration,
// maxCapacity, price, description, imageCover. order is ALSO required here
// (even though the schema itself doesn't require it) and must be supplied
// explicitly - it can't be safely auto-computed from the database's
// current max order, since most of the real ~32 tours aren't uploaded yet
// and doing so would badly undercount. The script checks for a collision
// with an existing tour's order before creating anything.
//
// {
//   "order": 12,
//   "title": "Új tábor neve",
//   "location": {
//     "description": "Szálláshely neve",
//     "type": "Point",
//     "coordinates": [19.0402, 47.4979],
//     "address": "1234 Város, Utca 1."
//   },
//   "startDate": "2027-06-15T14:00:00.000Z",
//   "duration": 3,
//   "maxCapacity": 20,
//   "price": 5000,
//   "summary": "Rövid összefoglaló",
//   "description": "Hosszabb leírás...",
//   "imageCover": "tour-11-cover.webp",
//   "images": ["tour-11-1.jpg"]
// }
//
// If OPENROUTESERVICE_API_KEY is configured, distanceFromBudapestKm is
// computed automatically from location.coordinates above - it's the same
// pre('save') hook every other tour creation path goes through (see
// utils/distance.js), nothing extra to do here.

import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';

const [, , filePath] = process.argv;

if (!filePath) {
  console.error('Usage: node scripts/addTour.js <path-to-tour.json>');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

if (data.order === undefined) {
  console.error(
    'tour.json must include an explicit "order" - see the usage comment at the top of this script.',
  );
  process.exit(1);
}

await mongoose.connect(config.db.testUri);

const existing = await Tour.findOne({ order: data.order }).select('title');
if (existing) {
  console.error(
    `Order ${data.order} is already taken by "${existing.title}" - pick a different one.`,
  );
  await mongoose.disconnect();
  process.exit(1);
}

const tour = await Tour.create(data);

console.log(`Created "${tour.title}" (order ${tour.order}) with id ${tour._id}`);
if (tour.distanceFromBudapestKm != null) {
  console.log(`Distance from Budapest: ${tour.distanceFromBudapestKm} km`);
}

await mongoose.disconnect();
