// Verifies getTour's new personalized distanceInfo (see tourController.js
// and utils/distance.js's resolveDistanceInfo) against REAL data and the
// real OpenRouteService API: a logged-in viewer with a geocoded home
// address gets distance/duration computed from THEIR home (with the
// correctly-suffixed city name), while an anonymous visitor or a member
// with no address falls back to the tour's own cached Budapest figures.
//
// Creates a throwaway tour (order 9982) and a throwaway user with a real
// Debrecen address - never touches real data. Safe to re-run, makes a
// handful of real geocoding/routing API calls.
//
// Usage:
//   node scripts/testPersonalizedTourDistance.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import User from '../src/models/userModel.js';
import { getTour } from '../src/controllers/tourController.js';

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };
}

const TEST_ORDER = 9982;

await mongoose.connect(config.db.testUri);

const leftover = await Tour.findOne({ order: TEST_ORDER });
if (leftover) await Tour.deleteOne({ _id: leftover._id });

// Real coordinates for Szeged - far enough from both Budapest and
// Debrecen that a wrong reference point produces a clearly different
// number, not something that could pass by coincidence.
const tour = await Tour.create({
  order: TEST_ORDER,
  title: 'ZZ Test Tour (personalized distance)',
  location: {
    type: 'Point',
    coordinates: [20.1414, 46.253], // [lng, lat] - Szeged
    address: 'Szeged, Teszt utca 1.',
  },
  startDate: new Date('2030-01-01'),
  duration: 3,
  maxCapacity: 10,
  summary: 'Teszt',
  description: 'Teszt tábor a személyre szabott távolságszámítás teszteléséhez.',
  imageCover: `tour-${TEST_ORDER}-cover.jpg`,
});

const testUserId = new mongoose.Types.ObjectId();

try {
  check('the tour itself got a real Budapest-based distance on creation', typeof tour.distanceFromBudapestKm === 'number');

  const user = await User.create({
    _id: testUserId,
    sub: `test-${testUserId}`,
    name: 'ZZ Teszt Debrecen Lakos',
    role: 'member',
    address: { city: 'Debrecen', country: 'Magyarország' },
  });
  check('the throwaway user\'s address actually geocoded', typeof user.location?.lat === 'number');

  // --- Logged-in viewer with a real address: personalized distance ---
  {
    const req = { params: { id: String(tour._id) }, session: { user: { id: String(testUserId) } } };
    const res = fakeRes();
    await getTour(req, res);

    check('distanceInfo.fromLabel is the correctly-suffixed city name', res.body.data.distanceInfo.fromLabel === 'Debrecentől');
    check('distanceInfo.distanceKm is a real number', typeof res.body.data.distanceInfo.distanceKm === 'number');
    check(
      'the personalized distance is meaningfully different from the tour\'s own Budapest-based figure (proves it actually used the viewer\'s location, not just echoing the fallback)',
      Math.abs(res.body.data.distanceInfo.distanceKm - tour.distanceFromBudapestKm) > 5,
    );
  }

  // --- Anonymous visitor (no session): falls back to Budapest ---
  {
    const req = { params: { id: String(tour._id) }, session: {} };
    const res = fakeRes();
    await getTour(req, res);

    check('an anonymous visitor gets the Budapest fallback label', res.body.data.distanceInfo.fromLabel === 'Budapesttől');
    check(
      'an anonymous visitor gets the tour\'s own cached Budapest distance, not a personalized one',
      res.body.data.distanceInfo.distanceKm === tour.distanceFromBudapestKm,
    );
  }

  // --- A logged-in member with no address on file: also falls back to Budapest ---
  {
    const noAddressId = new mongoose.Types.ObjectId();
    await User.create({ _id: noAddressId, sub: `test-${noAddressId}`, name: 'ZZ Teszt Cím Nélkül', role: 'member' });
    const req = { params: { id: String(tour._id) }, session: { user: { id: String(noAddressId) } } };
    const res = fakeRes();
    await getTour(req, res);

    check('a member with no address falls back to Budapest too', res.body.data.distanceInfo.fromLabel === 'Budapesttől');
    await User.deleteOne({ _id: noAddressId });
  }
} finally {
  await User.deleteOne({ _id: testUserId });
  await Tour.deleteOne({ _id: tour._id });
  console.log('\nCleaned up the throwaway test tour and user.');
}

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');

await mongoose.disconnect();
process.exit(0);
