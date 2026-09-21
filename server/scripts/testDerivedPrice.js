// Verifies tourModel.js's price pre('save') hook - once
// accommodationPricePerNight is set, price becomes the average price per
// person per night, assuming the tour fills to maxCapacity
// (rate / maxCapacity - duration-independent), rounded UP (never to
// nearest or down, so the advertised price is never an under-estimate),
// recomputed whenever either input changes. A tour that never sets
// accommodationPricePerNight keeps its old plain manually-entered price
// untouched.
//
// Snapshots and restores a real tour's fields - safe to re-run.
//
// Usage:
//   node scripts/testDerivedPrice.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

await mongoose.connect(config.db.testUri);

const tour = await Tour.findOne({ order: 2 });
if (!tour) {
  console.error('Tour order 2 not found - cannot run this check.');
  process.exit(1);
}

const original = {
  price: tour.price,
  duration: tour.duration,
  maxCapacity: tour.maxCapacity,
  accommodationPricePerNight: tour.accommodationPricePerNight,
};

try {
  // A tour with no accommodationPricePerNight set keeps its old manual
  // price even when something unrelated changes.
  tour.accommodationPricePerNight = undefined;
  tour.price = 12345;
  await tour.save();
  check('price is untouched when accommodationPricePerNight is unset', tour.price === 12345);

  // Setting accommodationPricePerNight now derives price = rate / maxCapacity.
  tour.maxCapacity = 10;
  tour.accommodationPricePerNight = 3000;
  await tour.save();
  check('price becomes rate / maxCapacity once accommodationPricePerNight is set', tour.price === 300);

  // Changing duration alone does NOT affect it - the per-person-per-night
  // average is duration-independent.
  tour.duration = tour.duration + 1;
  await tour.save();
  check('price is unaffected by duration changes (duration-independent figure)', tour.price === 300);

  // Changing maxCapacity alone recomputes.
  tour.maxCapacity = 20;
  await tour.save();
  check('price recomputes when maxCapacity changes afterward', tour.price === 150); // 3000 / 20

  // Changing accommodationPricePerNight alone recomputes too.
  tour.accommodationPricePerNight = 4000;
  await tour.save();
  check('price recomputes when accommodationPricePerNight changes afterward', tour.price === 200); // 4000 / 20

  // A fractional result (176.47...) rounds UP to 177, not down to 176 -
  // discriminates ceiling from round-to-nearest, unlike the exact
  // divisions above.
  tour.maxCapacity = 17;
  tour.accommodationPricePerNight = 3000;
  await tour.save();
  check('a fractional price rounds up (177), not to nearest (176)', tour.price === 177);

  // Changing something unrelated (summary) does NOT recompute (isModified guard).
  tour.price = 999; // simulate a stale value that should NOT get silently recomputed here
  tour.summary = `${tour.summary ?? ''} `.trim() || tour.summary;
  await tour.save();
  check(
    'price is left alone when neither accommodationPricePerNight nor maxCapacity changed',
    tour.price === 999,
  );
} finally {
  tour.price = original.price;
  tour.duration = original.duration;
  tour.maxCapacity = original.maxCapacity;
  tour.accommodationPricePerNight = original.accommodationPricePerNight;
  await tour.save();
  console.log('\nRestored tour order 2 to its original values.');
}

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');

await mongoose.disconnect();
