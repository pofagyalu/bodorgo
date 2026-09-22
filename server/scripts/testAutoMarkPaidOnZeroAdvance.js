// Verifies the "0% advance means nothing is owed, so mark everyone paid
// automatically" rule (see reservationController.js's
// markAllAttendeesPaidForTour and tourController.js's updateTour) end to
// end - going through the real updateTour handler, not just the pure
// function, since the trigger condition (isModified check, captured
// before save() clears it) matters too.
//
// Creates its own throwaway tour + reservation (order 9987, distinct from
// other throwaway orders used elsewhere) with fake attendee user ids -
// never touches real tour/reservation data. Safe to re-run.
//
// Usage:
//   node scripts/testAutoMarkPaidOnZeroAdvance.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import Reservation from '../src/models/reservationModel.js';
import { updateTour } from '../src/controllers/tourController.js';

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

const TEST_ORDER = 9987;

await mongoose.connect(config.db.testUri);

// Clean slate if a previous run left one behind.
const leftover = await Tour.findOne({ order: TEST_ORDER });
if (leftover) {
  await Reservation.deleteMany({ tour: leftover._id });
  await Tour.deleteOne({ _id: leftover._id });
}

const tour = await Tour.create({
  order: TEST_ORDER,
  title: 'ZZ Test Tour (auto-mark-paid)',
  location: { description: 'Teszt', address: 'Teszt utca 1.', coordinates: [19, 47] },
  startDate: new Date('2030-01-01'),
  duration: 3,
  maxCapacity: 10,
  summary: 'Teszt',
  description: 'Teszt tábor az automatikus fizetettség jelöléséhez.',
  imageCover: `tour-${TEST_ORDER}-cover.jpg`,
  accommodationPricePerNight: 10000,
  advancePaymentPercentage: 20, // starts configured but nonzero
});

const reservation = await Reservation.create({
  tour: tour._id,
  bookedBy: new mongoose.Types.ObjectId(),
  attendees: [
    { user: new mongoose.Types.ObjectId(), name: 'Teszt Elek', nights: 2, paid: false },
    { user: new mongoose.Types.ObjectId(), name: 'Teszt Ilona', nights: 2, paid: false },
  ],
});

try {
  // --- A nonzero advance change does NOT auto-mark anyone paid ---
  {
    const req = { params: { id: String(tour._id) }, body: { advancePaymentPercentage: 30 } };
    await updateTour(req, fakeRes());
    const fresh = await Reservation.findById(reservation._id);
    check(
      'changing advance to a nonzero value does not auto-mark attendees paid',
      fresh.attendees.every((a) => a.paid === false),
    );
  }

  // --- Setting advance to exactly 0 auto-marks every current attendee paid ---
  {
    const req = { params: { id: String(tour._id) }, body: { advancePaymentPercentage: 0 } };
    await updateTour(req, fakeRes());
    const freshTour = await Tour.findById(tour._id);
    const freshReservation = await Reservation.findById(reservation._id);
    check('advancePaymentPercentage is now 0 on the tour', freshTour.advancePaymentPercentage === 0);
    check(
      'every attendee got auto-marked paid once advance became exactly 0',
      freshReservation.attendees.every((a) => a.paid === true),
    );
  }

  // --- Saving 0 again (already 0, not a real change) doesn't error and stays paid ---
  {
    const req = { params: { id: String(tour._id) }, body: { advancePaymentPercentage: 0, summary: 'Teszt módosítva' } };
    await updateTour(req, fakeRes());
    const freshReservation = await Reservation.findById(reservation._id);
    check(
      'saving 0 again (unmodified) is a no-op, still all paid',
      freshReservation.attendees.every((a) => a.paid === true),
    );
  }
} finally {
  await Reservation.deleteOne({ _id: reservation._id });
  await Tour.deleteOne({ _id: tour._id });
  console.log('\nCleaned up the throwaway test tour and reservation.');
}

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');

await mongoose.disconnect();
