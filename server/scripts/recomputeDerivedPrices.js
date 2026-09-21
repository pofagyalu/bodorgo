// One-off fix: every tour that already had accommodationPricePerNight set
// before tourModel.js's price-derivation formula was corrected (it used
// to compute the whole house's total fee, not the average per person per
// night) is sitting on a stale `price` value. Re-saving those tours
// through Mongoose re-runs the (now correct) pre('save') hook and fixes
// it, without needing to touch every one by hand in the admin UI.
//
// Safe to re-run - a tour whose price already matches the correct formula
// is simply saved again with no effective change.
//
// Usage:
//   node scripts/recomputeDerivedPrices.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';

await mongoose.connect(config.db.testUri);

const tours = await Tour.find({ accommodationPricePerNight: { $ne: null } });
console.log(`Found ${tours.length} tour(s) with accommodationPricePerNight set.`);

for (const tour of tours) {
  const before = tour.price;
  // Force the hook to run even though nothing else is changing -
  // markModified bypasses Mongoose's "value didn't actually change, skip
  // it" optimization that would otherwise make isModified() stay false.
  tour.markModified('accommodationPricePerNight');
  await tour.save();
  console.log(`- ${tour.order}. ${tour.title}: price ${before} -> ${tour.price}`);
}

console.log('\nDone.');
await mongoose.disconnect();
