// Verifies getAlltours' corrected card price end-to-end against a real
// tour with real reservations - once actual attendees exist, the
// advertised "Ft/fő/éj" price should reflect their real average (see
// computeAttendeePayments' averagePricePerPersonPerNight), not the
// pre-registration assumption computed by tourModel.js's pre('save')
// hook. The pure-function math is already covered by
// testAttendeePayments.js; this checks the populate() wiring (attendees.
// user role/birthday) and getAlltours' own price-override actually work
// together against real data.
//
// Temporarily sets pricingMode/accommodationPricePerNight/
// childPricePerNight/childAgeLimitYears/advancePaymentPercentage on a
// real tour, then restores its original values in a finally block - safe
// to re-run.
//
// Usage:
//   node scripts/testTourListPrice.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import Reservation from '../src/models/reservationModel.js';
import { getAlltours } from '../src/controllers/tourController.js';
import { computeAttendeePayments } from '../src/controllers/reservationController.js';

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    // getAlltours reads res.locals.queryOverride (set by aliasLastTours
    // in the real route chain, absent here since this test calls
    // getAlltours directly) - a real Express res always has .locals, so
    // this needs one too.
    locals: {},
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
  childPricePerNight: tour.childPricePerNight,
  childAgeLimitYears: tour.childAgeLimitYears,
  advancePaymentPercentage: tour.advancePaymentPercentage,
  clubSubsidyAmount: tour.clubSubsidyAmount,
};

try {
  // A child-discount scenario, same shape as the admin's real report:
  // the flat adult rate alone would overstate what's actually being
  // charged once a child attendee gets the lower rate.
  tour.pricingMode = 'perPerson';
  tour.accommodationPricePerNight = 4000;
  tour.childPricePerNight = 0;
  tour.childAgeLimitYears = 99; // guarantees every real attendee on this tour counts as a "child" for this test
  tour.advancePaymentPercentage = 20;
  tour.clubSubsidyAmount = 0;
  await tour.save();

  const res = fakeRes();
  await getAlltours({ query: {} }, res);
  const listedTour = res.body.data.tours.find((t) => String(t._id) === String(tour._id));

  // The independently-computed expected value, not a hand-assumed one -
  // some of tour 2's real attendees genuinely have no birthday on record
  // (login-less dependents added by hand before this feature existed),
  // and those correctly default to the adult rate even under
  // childAgeLimitYears: 99 (see computeAttendeePayments' own fallback),
  // so the true average isn't simply 0 even though every birthday-having
  // attendee gets the free child rate.
  const freshTour = await Tour.findOne({ order: 2 });
  const reservations = await Reservation.find({ tour: freshTour._id }).populate({
    path: 'attendees.user',
    select: 'role birthday',
  });
  const { totals: expectedTotals } = computeAttendeePayments(freshTour, reservations);

  check('the tour appears in the list response', !!listedTour);
  check(
    'the list price is corrected down from the flat adult rate (4000) once real attendees get the child rate (0)',
    listedTour.price < 4000,
  );
  check(
    'the corrected average matches computeAttendeePayments\' own figure exactly',
    listedTour.price === expectedTotals.averagePricePerPersonPerNight,
  );
} finally {
  tour.pricingMode = original.pricingMode;
  tour.accommodationPricePerNight = original.accommodationPricePerNight;
  tour.childPricePerNight = original.childPricePerNight;
  tour.childAgeLimitYears = original.childAgeLimitYears;
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
