import mongoose from 'mongoose';
import Tour from '../models/tourModel.js';
import TourReport from '../models/tourReportModel.js';
import AppError from './appError.js';

// A closed tour (tour.closed - see tourModel.js and tourController.js's
// closeTour) is finished for good: nothing about it can be changed any
// more, by anyone, an admin included. There is no way back in the app -
// only by setting `closed` to false in the database by hand.

const CLOSED_MESSAGE = 'Ez a tábor le van zárva, már nem módosítható.';

// For a controller that has the tour (or just its `closed`) in hand.
export function assertTourOpen(tour) {
  if (tour?.closed) throw new AppError(CLOSED_MESSAGE, 403);
}

// The same by id, for a controller that only has that (nothing happens if
// there's no such tour - the controller's own 404 says so).
export async function assertTourOpenById(tourId) {
  if (!tourId || !mongoose.isValidObjectId(tourId)) return;
  assertTourOpen(await Tour.findById(tourId).select('closed'));
}

// The beszámoló is the one thing a closed tour still lets an admin write -
// until it's Kész: a finished one is frozen with the tour (the reopen route
// has plain tourOpen, so on a closed tour there's no Visszanyitás either).
export async function tourReportOpen(req, res, next) {
  const param = req.params.id ?? req.params.tourId;
  const query = mongoose.isValidObjectId(param) ? { _id: param } : { slug: param };
  const tour = await Tour.findOne(query).select('closed');
  if (tour?.closed && (await TourReport.exists({ tour: tour._id, status: 'final' }))) {
    throw new AppError(
      'Ez a tábor le van zárva, és a beszámolója kész – már nem módosítható.',
      403,
    );
  }
  next();
}

// Route middleware for everything that changes a tour: 403 if the tour in
// the address (:id or :tourId - its id or its slug) is closed. A tour that
// doesn't exist is left to the controller's own 404.
export async function tourOpen(req, res, next) {
  const param = req.params.id ?? req.params.tourId;
  const query = mongoose.isValidObjectId(param) ? { _id: param } : { slug: param };
  assertTourOpen(await Tour.findOne(query).select('closed'));
  next();
}
