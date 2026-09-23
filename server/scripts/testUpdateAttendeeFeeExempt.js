// Verifies updateAttendeeFeeExempt (see reservationController.js) against
// real DB data: setting feeExempt actually persists, flips the
// attendee's own paid flag to match (since the profile page's own
// Fizetve/Nincs kifizetve reads that field directly, not
// computeAttendeePayments' derived value), and a subsequent
// computeAttendeePayments call reflects the change. Also confirms
// unmarking reverts paid, and input validation rejects a non-boolean.
//
// Creates its own throwaway tour + reservation (order 9981) - never
// touches real data. Safe to re-run.
//
// Usage:
//   node scripts/testUpdateAttendeeFeeExempt.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import Reservation from '../src/models/reservationModel.js';
import User from '../src/models/userModel.js';
import { updateAttendeeFeeExempt, computeAttendeePayments } from '../src/controllers/reservationController.js';

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

const TEST_ORDER = 9981;

await mongoose.connect(config.db.testUri);

const leftover = await Tour.findOne({ order: TEST_ORDER });
if (leftover) {
  await Reservation.deleteMany({ tour: leftover._id });
  await Tour.deleteOne({ _id: leftover._id });
}

const tour = await Tour.create({
  order: TEST_ORDER,
  title: 'ZZ Test Tour (updateAttendeeFeeExempt)',
  location: { description: 'Teszt', address: 'Teszt utca 1.', coordinates: [19, 47] },
  startDate: new Date('2030-01-01'),
  duration: 3,
  maxCapacity: 10,
  summary: 'Teszt',
  description: 'Teszt tábor a díjmentesség teszteléséhez.',
  imageCover: `tour-${TEST_ORDER}-cover.jpg`,
  accommodationPricePerNight: 6000,
  advancePaymentPercentage: 20,
});

const guestId = new mongoose.Types.ObjectId();
await User.create({ _id: guestId, sub: `test-${guestId}`, name: 'ZZ Meghívott Vendég', role: 'guest' });

const reservation = await Reservation.create({
  tour: tour._id,
  bookedBy: guestId,
  attendees: [{ user: guestId, name: 'ZZ Meghívott Vendég', nights: 2, paid: false }],
});
const attendeeId = String(reservation.attendees[0]._id);

try {
  // --- Marking exempt sets both feeExempt and paid ---
  {
    const req = { params: { reservationId: String(reservation._id), attendeeId }, body: { feeExempt: true } };
    const res = fakeRes();
    await updateAttendeeFeeExempt(req, res);

    check('responds 200', res.statusCode === 200);
    check('the response reflects feeExempt: true', res.body.data.attendee.feeExempt === true);
    check('the response reflects paid: true (nothing left to collect)', res.body.data.attendee.paid === true);

    const reloaded = await Reservation.findById(reservation._id);
    const attendee = reloaded.attendees.id(attendeeId);
    check('feeExempt actually persisted to the DB', attendee.feeExempt === true);
    check('paid actually persisted to true in the DB too', attendee.paid === true);

    const { attendeePayments } = computeAttendeePayments(await Tour.findById(tour._id), [
      await Reservation.findById(reservation._id).populate('attendees.user'),
    ]);
    check('computeAttendeePayments now shows 0 owed for this attendee', attendeePayments[0].totalPrice === 0 && attendeePayments[0].advance === 0 && attendeePayments[0].rest === 0);
  }

  // --- Unmarking exempt reverts paid too ---
  {
    const req = { params: { reservationId: String(reservation._id), attendeeId }, body: { feeExempt: false } };
    const res = fakeRes();
    await updateAttendeeFeeExempt(req, res);

    check('feeExempt: false is reflected in the response', res.body.data.attendee.feeExempt === false);
    check('paid reverts to false once no longer exempt', res.body.data.attendee.paid === false);
  }

  // --- Input validation ---
  {
    const req = { params: { reservationId: String(reservation._id), attendeeId }, body: { feeExempt: 'yes' } };
    const res = fakeRes();
    let threw = false;
    try {
      await updateAttendeeFeeExempt(req, res);
    } catch (err) {
      threw = true;
    }
    check('a non-boolean feeExempt is rejected', threw);
  }

  // --- Unknown reservation/attendee ---
  {
    const req = { params: { reservationId: new mongoose.Types.ObjectId().toString(), attendeeId }, body: { feeExempt: true } };
    const res = fakeRes();
    let threw = false;
    try {
      await updateAttendeeFeeExempt(req, res);
    } catch (err) {
      threw = true;
    }
    check('an unknown reservation id is rejected', threw);
  }
} finally {
  await User.deleteOne({ _id: guestId });
  await Reservation.deleteMany({ tour: tour._id });
  await Tour.deleteOne({ _id: tour._id });
  console.log('\nCleaned up the throwaway test tour, reservation, and user.');
}

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');

await mongoose.disconnect();
process.exit(0);
