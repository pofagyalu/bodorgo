import Tour from '../models/tourModel.js';
import Reservation from '../models/reservationModel.js';
import AppError from '../utils/appError.js';

// Same "did this user actually show up on this tour" check the
// restricted-images feature already uses (tourImageController.js) - a
// review's legitimacy depends on having actually attended, so there's no
// admin override here the way there is for viewing restricted photos.
async function isAttendee(userId, tourId) {
  return !!(await Reservation.exists({ tour: tourId, 'attendees.user': userId }));
}

// A tour can only be reviewed once it's over - from midnight after its
// last day (startDate + duration days, in local time).
export function tourHasEnded(tour, now = new Date()) {
  const end = new Date(tour.startDate);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + tour.duration);
  return now >= end;
}

// GET /tours/:tourId/reviews/me - tells the client both whether this
// viewer is even allowed to review this tour (an attendee, and the tour
// has ended), and, if so, whatever
// they've already rated it - review-stars.ts uses this both to decide
// whether to render itself at all and to pre-fill the control to the
// saved value instead of starting blank. Always 200 (never 403) - "am I
// allowed to review" isn't sensitive information about the caller
// themselves.
export const getMyReview = async (req, res) => {
  const attendee = await isAttendee(req.user._id, req.params.tourId);
  if (!attendee) {
    return res
      .status(200)
      .json({ status: 'success', data: { isAttendee: false, hasEnded: false, rating: null } });
  }

  const tour = await Tour.findById(req.params.tourId).select('+reviews');
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }

  const existing = tour.reviews.find((r) => r.user.toString() === req.user._id.toString());
  res.status(200).json({
    status: 'success',
    data: { isAttendee: true, hasEnded: tourHasEnded(tour), rating: existing?.rating ?? null },
  });
};

// PUT /tours/:tourId/reviews - only an actual attendee of this tour can
// review it, and only once it has ended. Upserts: submitting again just replaces this same person's
// earlier rating ("change it any time"), never adds a second entry.
export const submitReview = async (req, res) => {
  const { rating } = req.body;
  if (!Number.isInteger(rating) || rating < 1 || rating > 10) {
    throw new AppError('Az értékelésnek 1 és 10 közötti egész számnak kell lennie.', 400);
  }

  if (!(await isAttendee(req.user._id, req.params.tourId))) {
    throw new AppError('Csak a tábor résztvevői értékelhetik a tábort.', 403);
  }

  const tour = await Tour.findById(req.params.tourId).select('+reviews');
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }
  if (!tourHasEnded(tour)) {
    throw new AppError('A tábort csak a vége után lehet értékelni.', 403);
  }

  const existing = tour.reviews.find((r) => r.user.toString() === req.user._id.toString());
  if (existing) {
    existing.rating = rating;
    existing.updatedAt = new Date();
  } else {
    tour.reviews.push({ user: req.user._id, rating, updatedAt: new Date() });
  }
  await tour.save();

  res.status(200).json({
    status: 'success',
    data: {
      rating,
      ratingsAverage: tour.ratingsAverage,
      ratingsQuantity: tour.ratingsQuantity,
    },
  });
};
