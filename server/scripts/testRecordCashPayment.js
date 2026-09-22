// Verifies recordCashPayment/resolvePayableAttendeesForAdmin (see
// paymentController.js) - the admin-only "I was handed cash in person"
// path, distinct from the self-service Stripe flow: an admin must be able
// to mark ANY attendee's advance as paid, not just their own family's
// (unlike resolvePayableAttendees), and the resulting Payment must be
// tagged method: 'cash' with no Stripe/receipt fields set.
//
// Creates its own throwaway tour + two unrelated reservations (order
// 9983, distinct from other throwaway orders used elsewhere) - never
// touches real data. Safe to re-run.
//
// Usage:
//   node scripts/testRecordCashPayment.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import Reservation from '../src/models/reservationModel.js';
import User from '../src/models/userModel.js';
import Payment from '../src/models/paymentModel.js';
import { recordCashPayment, resolvePayableAttendeesForAdmin } from '../src/controllers/paymentController.js';

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

function fakeRes() {
  const res = {
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
  return res;
}

const TEST_ORDER = 9983;

await mongoose.connect(config.db.testUri);

const leftover = await Tour.findOne({ order: TEST_ORDER });
if (leftover) {
  await Reservation.deleteMany({ tour: leftover._id });
  await Tour.deleteOne({ _id: leftover._id });
}

const tour = await Tour.create({
  order: TEST_ORDER,
  title: 'ZZ Test Tour (recordCashPayment)',
  location: { description: 'Teszt', address: 'Teszt utca 1.', coordinates: [19, 47] },
  startDate: new Date('2030-01-01'),
  duration: 3,
  maxCapacity: 10,
  summary: 'Teszt',
  description: 'Teszt tábor a készpénzes fizetés teszteléséhez.',
  imageCover: `tour-${TEST_ORDER}-cover.jpg`,
  accommodationPricePerNight: 9000,
  pricingMode: 'perPerson',
  advancePaymentPercentage: 50,
});

const adminId = new mongoose.Types.ObjectId();
const familyAId = new mongoose.Types.ObjectId();
const familyBId = new mongoose.Types.ObjectId();
const alreadyPaidId = new mongoose.Types.ObjectId();

await User.create([
  { _id: adminId, sub: `test-${adminId}`, name: 'Admin', role: 'admin' },
  { _id: familyAId, sub: `test-${familyAId}`, name: 'Family A tag', role: 'member', familyId: new mongoose.Types.ObjectId() },
  { _id: familyBId, sub: `test-${familyBId}`, name: 'Family B tag', role: 'member', familyId: new mongoose.Types.ObjectId() },
  { _id: alreadyPaidId, sub: `test-${alreadyPaidId}`, name: 'Már fizetett', role: 'member' },
]);

const reservationA = await Reservation.create({
  tour: tour._id,
  bookedBy: familyAId,
  attendees: [{ user: familyAId, name: 'Family A tag', nights: 2, paid: false }],
});
const reservationB = await Reservation.create({
  tour: tour._id,
  bookedBy: familyBId,
  attendees: [
    { user: familyBId, name: 'Family B tag', nights: 2, paid: false },
    { user: alreadyPaidId, name: 'Már fizetett', nights: 2, paid: true },
  ],
});

try {
  const admin = { _id: adminId, role: 'admin' };

  // --- An admin can mark two attendees from two entirely different
  // families in one call - resolvePayableAttendees (the self-service
  // version) would reject this as "outside my family". ---
  {
    const attendeeAId = String(reservationA.attendees[0]._id);
    const attendeeBId = String(reservationB.attendees.find((a) => String(a.user) === String(familyBId))._id);

    const req = { body: { tourId: String(tour._id), attendeeIds: [attendeeAId, attendeeBId] }, user: admin };
    const res = fakeRes();
    await recordCashPayment(req, res);

    check('recordCashPayment responds 201', res.statusCode === 201);
    check('payment is immediately Succeeded (no Stripe round-trip)', res.body?.data?.payment?.status === 'Succeeded');
    check('payment is tagged method: cash', res.body?.data?.payment?.method === 'cash');
    check('payment has no providerPaymentId (never touched Stripe)', !res.body?.data?.payment?.providerPaymentId);
    check('payment has no receiptFilename (no PDF for cash)', !res.body?.data?.payment?.receiptFilename);
    check('payment covers both attendees across the two families', res.body?.data?.payment?.attendees?.length === 2);

    const updatedA = await Reservation.findById(reservationA._id);
    const updatedB = await Reservation.findById(reservationB._id);
    check('Family A attendee is now marked paid on the reservation', updatedA.attendees[0].paid === true);
    check(
      'Family B attendee is now marked paid on the reservation',
      updatedB.attendees.find((a) => String(a.user) === String(familyBId)).paid === true,
    );

    const saved = await Payment.findById(res.body.data.payment._id);
    check('the Payment record actually persisted with method: cash', saved?.method === 'cash');
  }

  // --- Requesting only an already-paid attendee - rejected, same "nothing
  // payable" rule as the self-service resolver. ---
  {
    const alreadyPaidAttendeeId = String(reservationB.attendees.find((a) => String(a.user) === String(alreadyPaidId))._id);
    let threw = false;
    try {
      await resolvePayableAttendeesForAdmin(tour._id, [alreadyPaidAttendeeId]);
    } catch (err) {
      threw = true;
    }
    check('requesting only an already-paid attendee throws (nothing payable)', threw);
  }

  // --- Missing/malformed input rejected the same way startPayment rejects it ---
  {
    const req = { body: { tourId: String(tour._id), attendeeIds: [] }, user: admin };
    const res = fakeRes();
    let threw = false;
    try {
      await recordCashPayment(req, res);
    } catch (err) {
      threw = true;
    }
    check('an empty attendeeIds array is rejected', threw);
  }
} finally {
  await Payment.deleteMany({ tour: tour._id });
  await User.deleteMany({ _id: { $in: [adminId, familyAId, familyBId, alreadyPaidId] } });
  await Reservation.deleteMany({ tour: tour._id });
  await Tour.deleteOne({ _id: tour._id });
  console.log('\nCleaned up the throwaway test tour, reservations, users, and payments.');
}

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');

await mongoose.disconnect();
