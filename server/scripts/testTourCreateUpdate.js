// Verifies the createTour/updateTour controller logic (order-collision
// checks, updateTour's load+.save() approach correctly regenerating the
// slug on a title change, and - the actual bug this caught - that
// updateTour accepts a slug identifier, not just a raw ObjectId, since the
// edit page's link always uses the tour's slug like everywhere else in the
// app). Creates and cleans up its own throwaway tour (order 9990) - safe to
// re-run.
//
// Usage:
//   node scripts/testTourCreateUpdate.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';

const TEST_ORDER = 9990;

function simulateCreateTour(body) {
  if (body.order === undefined) throw new Error('order is required');
  return Tour.findOne({ order: body.order })
    .select('title')
    .then((existing) => {
      if (existing) throw new Error(`order ${body.order} already taken by "${existing.title}"`);
      return Tour.create(body);
    });
}

// Mirrors tourController.js's updateTour exactly, including its id-or-slug
// resolution - a plain findById here would silently miss the slug bug.
async function simulateUpdateTour(identifier, body) {
  const query = mongoose.isValidObjectId(identifier) ? { _id: identifier } : { slug: identifier };
  const tour = await Tour.findOne(query);
  if (!tour) throw new Error('tour not found');
  if (body.order !== undefined && body.order !== tour.order) {
    const existing = await Tour.findOne({ order: body.order }).select('title');
    if (existing) throw new Error(`order ${body.order} already taken by "${existing.title}"`);
  }
  for (const [key, value] of Object.entries(body)) {
    tour[key] = value;
  }
  await tour.save();
  return tour;
}

await mongoose.connect(config.db.testUri);
await Tour.deleteOne({ order: TEST_ORDER }); // clean slate if a previous run left one behind

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

const created = await simulateCreateTour({
  order: TEST_ORDER,
  title: 'ZZ Test Tour Original',
  startDate: new Date('2027-09-01'),
  duration: 1,
  maxCapacity: 10,
  price: 500,
  description: 'temp',
  imageCover: 'tour-1-cover.webp',
});
check('created tour has correct initial slug', created.slug === 'zz-test-tour-original');

let collisionRejected = false;
try {
  await simulateCreateTour({
    order: TEST_ORDER,
    title: 'Duplicate order attempt',
    startDate: new Date(),
    duration: 1,
    maxCapacity: 1,
    price: 1,
    description: 'x',
    imageCover: 'x.webp',
  });
} catch (err) {
  collisionRejected = /already taken/.test(err.message);
}
check('create rejects a duplicate order', collisionRejected);

const updated = await simulateUpdateTour(created._id, { title: 'ZZ Test Tour Renamed' });
check('update regenerates slug on title change', updated.slug === 'zz-test-tour-renamed');

// The actual reported bug: editing via the tour-edit page passes the
// tour's slug (from the link's [routerLink]), not its _id.
const updatedBySlug = await simulateUpdateTour('zz-test-tour-renamed', { title: 'ZZ Test Tour Renamed Again' });
check('update accepts a slug identifier, not just an ObjectId', updatedBySlug.slug === 'zz-test-tour-renamed-again');

await Tour.deleteOne({ _id: created._id });
console.log('\nCleaned up test tour.');

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');

await mongoose.disconnect();
