// Verifies deleteCashPayment (see paymentController.js) - the admin's
// "undo, I clicked the wrong row" action: reverts the covered
// attendee(s) back to unpaid and removes the Payment record, but only
// ever for a method: 'cash' payment - a real Stripe payment must be
// completely untouchable this way. Also verifies getTour's own
// paymentId/paymentMethod exposure per attendee tracks the change
// correctly, since that's what drives the attendee-list's cash toggle.
//
// Creates its own throwaway tour + reservation (order 9980) - never
// touches real data. Safe to re-run.
//
// Usage:
//   node scripts/testDeleteCashPayment.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import Reservation from '../src/models/reservationModel.js';
import User from '../src/models/userModel.js';
import Payment from '../src/models/paymentModel.js';
import { recordCashPayment, deleteCashPayment } from '../src/controllers/paymentController.js';
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

const TEST_ORDER = 9980;

await mongoose.connect(config.db.testUri);

const leftover = await Tour.findOne({ order: TEST_ORDER });
if (leftover) {
  await Reservation.deleteMany({ tour: leftover._id });
  await Payment.deleteMany({ tour: leftover._id });
  await Tour.deleteOne({ _id: leftover._id });
}

const tour = await Tour.create({
  order: TEST_ORDER,
  title: 'ZZ Test Tour (deleteCashPayment)',
  slug: `zz-test-tour-delete-cash-payment-${TEST_ORDER}`,
  location: { type: 'Point', coordinates: [19, 47], description: 'Teszt', address: 'Teszt utca 1.' },
  startDate: new Date('2030-01-01'),
  duration: 3,
  maxCapacity: 10,
  summary: 'Teszt',
  description: 'Teszt tábor a készpénzes fizetés visszavonásának teszteléséhez.',
  imageCover: `tour-${TEST_ORDER}-cover.jpg`,
  accommodationPricePerNight: 6000,
  advancePaymentPercentage: 20,
});

const adminId = new mongoose.Types.ObjectId();
const guestId = new mongoose.Types.ObjectId();
await User.create([
  { _id: adminId, sub: `test-${adminId}`, name: 'ZZ Admin', role: 'admin' },
  { _id: guestId, sub: `test-${guestId}`, name: 'ZZ Vendég', role: 'guest' },
]);

const reservation = await Reservation.create({
  tour: tour._id,
  bookedBy: guestId,
  attendees: [{ user: guestId, name: 'ZZ Vendég', nights: 2, paid: false }],
});
const attendeeId = String(reservation.attendees[0]._id);

try {
  // --- Record a cash payment, confirm getTour reflects it ---
  let cashPaymentId;
  {
    const req = { body: { tourId: String(tour._id), attendeeIds: [attendeeId] }, user: { _id: adminId } };
    const res = fakeRes();
    await recordCashPayment(req, res);
    cashPaymentId = res.body.data.payment._id;

    const tourReq = { params: { id: String(tour._id) }, session: {} };
    const tourRes = fakeRes();
    await getTour(tourReq, tourRes);
    const row = tourRes.body.data.attendeePayments.find((p) => p.attendeeId === attendeeId);
    check('getTour reports paymentMethod: cash for this attendee', row.paymentMethod === 'cash');
    check('getTour reports the matching paymentId', row.paymentId === String(cashPaymentId));
    check('the attendee is marked paid', row.paid === true);
  }

  // --- Undo it ---
  {
    const req = { params: { id: String(cashPaymentId) } };
    const res = fakeRes();
    await deleteCashPayment(req, res);
    check('deleteCashPayment responds 204', res.statusCode === 204);

    const reloadedReservation = await Reservation.findById(reservation._id);
    check('the attendee reverted to unpaid', reloadedReservation.attendees.id(attendeeId).paid === false);

    const stillExists = await Payment.findById(cashPaymentId);
    check('the Payment record was actually deleted', stillExists === null);

    const tourReq = { params: { id: String(tour._id) }, session: {} };
    const tourRes = fakeRes();
    await getTour(tourReq, tourRes);
    const row = tourRes.body.data.attendeePayments.find((p) => p.attendeeId === attendeeId);
    check('getTour no longer reports a payment for this attendee', row.paymentMethod === null && row.paymentId === null);
  }

  // --- A real Stripe payment can never be deleted this way ---
  {
    const stripePayment = await Payment.create({
      purpose: 'tourAdvance',
      method: 'stripe',
      tour: tour._id,
      createdBy: guestId,
      attendees: [{ reservationId: reservation._id, attendeeId, name: 'ZZ Vendég', amount: 1000 }],
      amount: 1000,
      status: 'Succeeded',
      providerPaymentId: 'cs_test_fake_for_this_test_only',
    });

    const req = { params: { id: String(stripePayment._id) } };
    const res = fakeRes();
    let threw = false;
    try {
      await deleteCashPayment(req, res);
    } catch (err) {
      threw = true;
    }
    check('a real Stripe payment is refused, not deleted', threw);

    const stillThere = await Payment.findById(stripePayment._id);
    check('the Stripe payment record is untouched', stillThere !== null);
  }

  // --- Unknown payment id ---
  {
    const req = { params: { id: new mongoose.Types.ObjectId().toString() } };
    const res = fakeRes();
    let threw = false;
    try {
      await deleteCashPayment(req, res);
    } catch (err) {
      threw = true;
    }
    check('an unknown payment id is rejected', threw);
  }
} finally {
  await Payment.deleteMany({ tour: tour._id });
  await User.deleteMany({ _id: { $in: [adminId, guestId] } });
  await Reservation.deleteMany({ tour: tour._id });
  await Tour.deleteOne({ _id: tour._id });
  console.log('\nCleaned up the throwaway test tour, reservation, users, and payments.');
}

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');

await mongoose.disconnect();
process.exit(0);
