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
  pricingMode: tour.pricingMode,
  accommodationPricePerNight: tour.accommodationPricePerNight,
  advancePaymentPercentage: tour.advancePaymentPercentage,
  clubSubsidyAmount: tour.clubSubsidyAmount,
};

try {
  // Pinned explicitly - this test's expected numbers are perHouse math,
  // regardless of whatever pricingMode this real tour actually has set
  // for real (it's been used to test perPerson pricing too - see
  // testTourListPrice.js).
  tour.pricingMode = 'perHouse';
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
  // Not the sum of the individual rows - each attendee's own share rounds
  // UP to a whole forint, so summing them would overstate the true total
  // by a few forints (see testAttendeePayments.js). The declared totals
  // are the tour's own exact configured numbers instead.
  const expectedTotalPrice = 2000 * (tour.duration - 1);
  const expectedAdvance = Math.ceil((expectedTotalPrice * 30) / 100);
  check(
    'totals reflect the tour\'s own exact configured numbers, not the sum of rounded-up rows',
    paymentTotals.totalPrice === expectedTotalPrice &&
      paymentTotals.advance === expectedAdvance &&
      paymentTotals.rest === expectedTotalPrice - expectedAdvance,
  );
} finally {
  tour.pricingMode = original.pricingMode;
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
