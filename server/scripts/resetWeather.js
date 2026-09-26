// Temporary CLI utility to force a tour's weather to be re-fetched from
// scratch - needed because refreshTourWeather() (tourController.js) never
// touches a day once it's frozen (isFinal: true), regardless of whether the
// tour's coordinates change afterwards. If a tour was saved with a wrong/
// placeholder location and already had some past days recorded under it,
// fixing the coordinates alone won't fix that weather data - this script
// wipes dailyWeather entirely so the next tour-details page view fetches
// everything fresh (historical for passed days, forecast for upcoming ones)
// using the corrected coordinates.
//
// Usage:
//   node scripts/resetWeather.js <tourId|order|slug>
//
// Accepts whatever's most convenient to identify the tour with - a Mongo
// _id, its numeric order, or its slug.

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';

const [, , identifier] = process.argv;

if (!identifier) {
  console.error('Usage: node scripts/resetWeather.js <tourId|order|slug|--all>');
  process.exit(1);
}

await mongoose.connect(config.db.testUri);

// --all: every tour at once - e.g. after a change to how the weather is
// fetched or classified (see utils/weather.js), since past days are
// frozen and would otherwise never be fetched again.
if (identifier === '--all') {
  const result = await Tour.updateMany(
    { 'dailyWeather.0': { $exists: true } },
    { $set: { dailyWeather: [] } },
  );
  console.log(
    `Cleared the weather of ${result.modifiedCount} tour(s). Each is fetched fresh the next time its page is opened.`,
  );
  await mongoose.disconnect();
  process.exit(0);
}

let tour;
if (mongoose.isValidObjectId(identifier)) {
  tour = await Tour.findById(identifier);
} else if (/^\d+$/.test(identifier)) {
  tour = await Tour.findOne({ order: Number(identifier) });
} else {
  tour = await Tour.findOne({ slug: identifier });
}

if (!tour) {
  console.error(`No tour found matching "${identifier}" (tried id, order, and slug).`);
  await mongoose.disconnect();
  process.exit(1);
}

const clearedCount = tour.dailyWeather.length;
tour.dailyWeather = [];
await tour.save();

console.log(
  `Cleared ${clearedCount} weather entr${clearedCount === 1 ? 'y' : 'ies'} for "${tour.title}" (order ${tour.order}). It will be fetched fresh next time the tour's page is opened.`,
);

await mongoose.disconnect();
