// Temporary CLI utility for updating an EXISTING tour's own fields (title,
// location, dates, description, etc.) from a JSON file - addTour.js only
// covers creating a brand new one. Deliberately loads the document and
// calls .save() rather than findByIdAndUpdate, so the model's pre('save')
// hooks actually run: the slug regenerates if the title changed, and
// distanceFromBudapestKm recomputes if location.coordinates changed (see
// tourModel.js) - a plain update bypasses both, which is exactly the kind
// of stale-cache bug tourController.js's own updateTour has to work around
// by hand for the same reason.
//
// Usage:
//   node scripts/updateTour.js <tourId|order|slug> <path-to-tour.json>
//
// tour.json only needs to contain the fields you want to change - anything
// omitted is left as-is. Same shape as addTour.js's tour.json otherwise.

import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';

const [, , tourIdentifier, filePath] = process.argv;

if (!tourIdentifier || !filePath) {
  console.error('Usage: node scripts/updateTour.js <tourId|order|slug> <path-to-tour.json>');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

await mongoose.connect(config.db.testUri);

let tour;
if (mongoose.isValidObjectId(tourIdentifier)) {
  tour = await Tour.findById(tourIdentifier);
} else if (/^\d+$/.test(tourIdentifier)) {
  tour = await Tour.findOne({ order: Number(tourIdentifier) });
} else {
  tour = await Tour.findOne({ slug: tourIdentifier });
}

if (!tour) {
  console.error(`No tour found matching "${tourIdentifier}"`);
  await mongoose.disconnect();
  process.exit(1);
}

if (data.order !== undefined && data.order !== tour.order) {
  const collision = await Tour.findOne({ order: data.order }).select('title');
  if (collision) {
    console.error(
      `Order ${data.order} is already taken by "${collision.title}" - pick a different one.`,
    );
    await mongoose.disconnect();
    process.exit(1);
  }
}

const before = {
  title: tour.title,
  distanceFromBudapestKm: tour.distanceFromBudapestKm,
};

for (const [key, value] of Object.entries(data)) {
  tour[key] = value;
}
await tour.save();

console.log(
  `Updated "${before.title}" -> "${tour.title}" (order ${tour.order}, slug "${tour.slug}").`,
);
if (tour.distanceFromBudapestKm !== before.distanceFromBudapestKm) {
  console.log(
    `Distance from Budapest: ${before.distanceFromBudapestKm ?? '—'} km -> ${tour.distanceFromBudapestKm ?? '—'} km`,
  );
}

await mongoose.disconnect();
