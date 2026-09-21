// Verifies getTour's new attendeePayments/paymentTotals fields end-to-end
// against a real tour with real reservations - the pure-function math is
// already covered by testAttendeePayments.js, this instead checks the
// populate() wiring (attendees.user role) and response shape actually
// work together against real data.
//
// Temporarily sets accommodationPricePerNight/advancePaymentPercentage on
// a real tour to get a non-null result, then restores its original
// values in a finally block - safe to re-run.
//
// Usage:
//   node scripts/testGetTourAttendeePayments.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import { getTour } from '../src/controllers/tourController.js';

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

// Same real tour (order 2) other scripts this session used, since it's
// known to have a real reservation with real attendees.
const tour = await Tour.findOne({ order: 2 });
if (!tour) {
  console.error('Tour order 2 not found - cannot run this check.');
  process.exit(1);
}

const original = {
  accommodationPricePerNight: tour.accommodationPricePerNight,
  advancePaymentPercentage: tour.advancePaymentPercentage,
  clubSubsidyAmount: tour.clubSubsidyAmount,
};

try {
  tour.accommodationPricePerNight = 2000;
  tour.advancePaymentPercentage = 30;
  tour.clubSubsidyAmount = 0;
  await tour.save();

  const res = fakeRes();
  await getTour({ params: { id: tour.slug } }, res);
  const { participantCount, attendeePayments, paymentTotals } = res.body.data;

  check('response includes attendeePayments/paymentTotals', 'attendeePayments' in res.body.data && 'paymentTotals' in res.body.data);
  check(
    'one payment row per actual attendee',
    Array.isArray(attendeePayments) && attendeePayments.length === participantCount,
  );
  check('paymentTotals is non-null once pricing is configured', paymentTotals !== null);
  check(
    'every row has a real name and a non-null totalPrice',
    attendeePayments.every((p) => typeof p.name === 'string' && p.name.length > 0 && p.totalPrice !== null),
  );
  check(
    'totals match the sum of the individual rows',
    paymentTotals.totalPrice === attendeePayments.reduce((s, p) => s + p.totalPrice, 0) &&
      paymentTotals.advance === attendeePayments.reduce((s, p) => s + p.advance, 0) &&
      paymentTotals.rest === attendeePayments.reduce((s, p) => s + p.rest, 0),
  );
} finally {
  tour.accommodationPricePerNight = original.accommodationPricePerNight;
  tour.advancePaymentPercentage = original.advancePaymentPercentage;
  tour.clubSubsidyAmount = original.clubSubsidyAmount;
  await tour.save();
  console.log('\nRestored tour order 2 to its original pricing fields.');
}

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');

await mongoose.disconnect();
