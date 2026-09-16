// Verifies the tour review feature (tourModel.js's reviews array +
// ratingsAverage/ratingsQuantity recompute hook, reviewController.js)
// against real data: tour order 2 ("Tamási szarvasnéző") and one of its
// real reservations' real attendees. Snapshots the tour's existing
// reviews/ratingsAverage/ratingsQuantity first and always restores them in
// a `finally` - this touches real production data, not a throwaway tour.
//
// Usage:
//   node scripts/testReviews.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import User from '../src/models/userModel.js';
import Reservation from '../src/models/reservationModel.js';
import { getMyReview, submitReview } from '../src/controllers/reviewController.js';

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

const tour = await Tour.findOne({ order: 2 }).select('+reviews');
const reservation = await Reservation.findOne({ tour: tour._id }).populate('attendees.user');
if (!tour || !reservation) {
  console.error('Need tour order 2 and at least one real reservation for it.');
  process.exit(1);
}
const attendee = reservation.attendees[0].user;

// Snapshot so this real tour's data can be restored exactly, regardless of
// pass/fail.
const originalReviews = tour.reviews.map((r) => ({ ...r.toObject() }));
const originalAverage = tour.ratingsAverage;
const originalQuantity = tour.ratingsQuantity;

const nonAttendee = await User.create({ name: 'ZZ Review Test Non-Attendee', role: 'guest' });

try {
  const startingCount = tour.reviews.length;

  const nonAttendeeMy = fakeRes();
  await getMyReview({ params: { tourId: tour._id.toString() }, user: nonAttendee }, nonAttendeeMy);
  check(
    "getMyReview says a non-attendee isn't allowed to review",
    nonAttendeeMy.body?.data?.isAttendee === false && nonAttendeeMy.body?.data?.rating === null,
  );

  let nonAttendeeSubmitError = null;
  try {
    await submitReview(
      { params: { tourId: tour._id.toString() }, user: nonAttendee, body: { rating: 7 } },
      fakeRes(),
    );
  } catch (err) {
    nonAttendeeSubmitError = err;
  }
  check(
    'a non-attendee cannot submit a review',
    !!nonAttendeeSubmitError && /Csak a tábor résztvevői/.test(nonAttendeeSubmitError.message),
  );

  for (const badRating of [0, 11, 3.5, 'seven']) {
    let validationError = null;
    try {
      await submitReview(
        { params: { tourId: tour._id.toString() }, user: attendee, body: { rating: badRating } },
        fakeRes(),
      );
    } catch (err) {
      validationError = err;
    }
    check(
      `rating ${JSON.stringify(badRating)} is rejected as invalid`,
      !!validationError && /1 és 10 közötti/.test(validationError.message),
    );
  }

  const firstSubmit = fakeRes();
  await submitReview(
    { params: { tourId: tour._id.toString() }, user: attendee, body: { rating: 8 } },
    firstSubmit,
  );
  check('a real attendee can submit a review', firstSubmit.body?.data?.rating === 8);
  check(
    'the reviews count went up by exactly one new entry',
    firstSubmit.body?.data?.ratingsQuantity === startingCount + 1,
  );

  const myReviewAfterFirst = fakeRes();
  await getMyReview({ params: { tourId: tour._id.toString() }, user: attendee }, myReviewAfterFirst);
  check(
    "getMyReview now returns the attendee's saved rating",
    myReviewAfterFirst.body?.data?.isAttendee === true &&
      myReviewAfterFirst.body?.data?.rating === 8,
  );

  // Changing it must replace, not add a second entry.
  const secondSubmit = fakeRes();
  await submitReview(
    { params: { tourId: tour._id.toString() }, user: attendee, body: { rating: 5 } },
    secondSubmit,
  );
  check(
    'changing an existing review replaces it rather than adding a second one',
    secondSubmit.body?.data?.rating === 5 &&
      secondSubmit.body?.data?.ratingsQuantity === startingCount + 1,
  );
} finally {
  await Tour.updateOne(
    { _id: tour._id },
    {
      $set: {
        reviews: originalReviews,
        ratingsAverage: originalAverage,
        ratingsQuantity: originalQuantity,
      },
    },
  );
  await User.deleteOne({ _id: nonAttendee._id });
  console.log('\nRestored the tour to its original reviews/ratings and cleaned up the test user.');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');

await mongoose.disconnect();
