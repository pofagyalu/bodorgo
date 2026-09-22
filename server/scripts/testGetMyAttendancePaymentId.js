// Verifies getMyAttendance's new paymentId lookup (see userController.js)
// - null when paid but with no matching Succeeded Payment (e.g. paid=true
// from historical/imported data, or the "0% advance" auto-mark, neither
// of which ever went through Stripe), and a real id once one exists.
//
// Creates its own throwaway tour + reservation + user + Payment (order
// 9985, distinct from other throwaway orders used elsewhere) - never
// touches real data. Safe to re-run.
//
// Usage:
//   node scripts/testGetMyAttendancePaymentId.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import Reservation from '../src/models/reservationModel.js';
import User from '../src/models/userModel.js';
import Payment from '../src/models/paymentModel.js';
import { getMyAttendance } from '../src/controllers/userController.js';

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

const TEST_ORDER = 9985;

await mongoose.connect(config.db.testUri);

const leftoverTour = await Tour.findOne({ order: TEST_ORDER });
if (leftoverTour) {
  await Reservation.deleteMany({ tour: leftoverTour._id });
  await Payment.deleteMany({ tour: leftoverTour._id });
  await Tour.deleteOne({ _id: leftoverTour._id });
}

const tour = await Tour.create({
  order: TEST_ORDER,
  title: 'ZZ Test Tour (getMyAttendance paymentId)',
  location: { description: 'Teszt', address: 'Teszt utca 1.', coordinates: [19, 47] },
  startDate: new Date('2030-01-01'),
  duration: 3,
  maxCapacity: 10,
  summary: 'Teszt',
  description: 'Teszt tábor a paymentId kereséshez.',
  imageCover: `tour-${TEST_ORDER}-cover.jpg`,
});

const userA = await User.create({ sub: 'test-paymentid-a', name: 'Teszt Előre Fizetett', role: 'member' });
const userB = await User.create({ sub: 'test-paymentid-b', name: 'Teszt Régi Adat', role: 'member' });

const reservation = await Reservation.create({
  tour: tour._id,
  bookedBy: userA._id,
  attendees: [
    // Paid via the real Stripe flow - should get a real paymentId.
    { user: userA._id, name: userA.name, nights: 2, paid: true },
    // paid=true but from "historical data"/no real Payment behind it -
    // should get paymentId: null, not crash or point at nothing.
    { user: userB._id, name: userB.name, nights: 2, paid: true },
  ],
});

const attendeeA = reservation.attendees.find((a) => String(a.user) === String(userA._id));

const payment = await Payment.create({
  purpose: 'tourAdvance',
  tour: tour._id,
  createdBy: userA._id,
  status: 'Succeeded',
  attendees: [{ reservationId: reservation._id, attendeeId: attendeeA._id, name: userA.name, amount: 7800 }],
  amount: 7800,
});

try {
  const resA = fakeRes();
  await getMyAttendance({ user: userA }, resA);
  const entryA = resA.body.data.tours.find((t) => String(t.tour._id) === String(tour._id));
  check('the real Stripe-paid attendee has paid=true', entryA?.paid === true);
  check('and a real matching paymentId', String(entryA?.paymentId) === String(payment._id));

  const resB = fakeRes();
  await getMyAttendance({ user: userB }, resB);
  const entryB = resB.body.data.tours.find((t) => String(t.tour._id) === String(tour._id));
  check('the historically-paid attendee also has paid=true', entryB?.paid === true);
  check('but paymentId is null (no receipt to point at)', entryB?.paymentId === null);
} finally {
  await Payment.deleteOne({ _id: payment._id });
  await Reservation.deleteOne({ _id: reservation._id });
  await User.deleteMany({ _id: { $in: [userA._id, userB._id] } });
  await Tour.deleteOne({ _id: tour._id });
  console.log('\nCleaned up the throwaway test tour, reservation, users, and payment.');
}

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');

await mongoose.disconnect();
