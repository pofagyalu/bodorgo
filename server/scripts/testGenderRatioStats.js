// Verifies getTourStats' new genderRatio field - the gender split pooled
// across every tour attendee on record (not every registered user), see
// tourController.js's comment there.
//
// Read-only against real data - creates nothing, safe to re-run.
//
// Usage:
//   node scripts/testGenderRatioStats.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Reservation from '../src/models/reservationModel.js';
import User from '../src/models/userModel.js';
import { getTourStats } from '../src/controllers/tourController.js';

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
      return this;
    },
  };
}

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

await mongoose.connect(config.db.testUri);

// Independently compute the expected split via a plain JS pass over every
// reservation, so the aggregation pipeline is checked against a completely
// different code path rather than against itself.
const reservations = await Reservation.find().select('tour attendees.user').lean();
const genderById = new Map(
  (await User.find().select('gender').lean()).map((u) => [String(u._id), u.gender]),
);

let maleCount = 0;
let femaleCount = 0;
for (const r of reservations) {
  for (const a of r.attendees) {
    const gender = genderById.get(String(a.user));
    if (gender === 'férfi') maleCount++;
    else if (gender === 'nő') femaleCount++;
  }
}

const expectedAvgMale = maleCount + femaleCount > 0 ? (maleCount / (maleCount + femaleCount)) * 100 : null;

const res = fakeRes();
await getTourStats({}, res);
const { genderRatio } = res.body.data;

check('response includes a genderRatio field', 'genderRatio' in res.body.data);

if (expectedAvgMale === null) {
  check('no tour has any gendered attendee yet, so genderRatio is null', genderRatio === null);
} else {
  check('genderRatio is not null when gendered attendee data exists', genderRatio !== null);
  check(
    `male/female percentages sum to exactly 100 (got ${genderRatio?.malePercentage}/${genderRatio?.femalePercentage})`,
    genderRatio && genderRatio.malePercentage + genderRatio.femalePercentage === 100,
  );
  check(
    `malePercentage matches an independently computed average (expected ~${Math.round(expectedAvgMale)}, got ${genderRatio?.malePercentage})`,
    genderRatio && Math.abs(genderRatio.malePercentage - Math.round(expectedAvgMale)) <= 1,
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');

await mongoose.disconnect();
