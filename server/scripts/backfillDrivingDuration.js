// One-time backfill: computes drivingDurationFromBudapestMinutes (and
// re-confirms distanceFromBudapestKm) for every existing tour that has
// location.coordinates set - the tourModel.js pre('save') hook only ever
// computes this for a NEW save/edit where location.coordinates actually
// changes, so tours created before this field existed would otherwise
// stay empty forever. One OpenRouteService request per tour (both
// numbers come back together - see utils/distance.js).
//
// Usage:
//   node scripts/backfillDrivingDuration.js            (dry run)
//   node scripts/backfillDrivingDuration.js --apply    (writes)

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import { computeDrivingRoute, BUDAPEST_CENTER } from '../src/utils/distance.js';

const apply = process.argv.includes('--apply');

await mongoose.connect(config.db.uri);

const tours = await Tour.find({ 'location.coordinates.1': { $exists: true } });
let updated = 0;
let failed = 0;

for (const tour of tours) {
  const route = await computeDrivingRoute(BUDAPEST_CENTER, {
    lat: tour.location.coordinates[1],
    lng: tour.location.coordinates[0],
  });
  if (!route) {
    console.log(`✗ Could not compute a route for "${tour.title}" (order ${tour.order}) - left as-is.`);
    failed++;
    continue;
  }

  console.log(
    `${apply ? 'Updating' : '[dry run] Would update'} "${tour.title}" (order ${tour.order}): ${route.distanceKm} km, ${route.durationMinutes} min`,
  );
  if (apply) {
    tour.distanceFromBudapestKm = route.distanceKm;
    tour.drivingDurationFromBudapestMinutes = route.durationMinutes;
    // Skip the pre('save') recompute hook - it only fires on a
    // location.coordinates change, which isn't the case here, and we've
    // already computed the same numbers it would.
    await tour.save({ validateModifiedOnly: true });
  }
  updated++;
}

console.log(`\n${apply ? 'Updated' : 'Would update'} ${updated} tour(s), ${failed} failed.`);
if (!apply) {
  console.log('This was a dry run - re-run with --apply to actually write these.');
}

await mongoose.disconnect();
process.exit(0);
