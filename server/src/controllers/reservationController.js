import Tour from '../models/tourModel.js';
import Reservation from '../models/reservationModel.js';
import AppError from '../utils/appError.js';

// Signs the current authenticated user up for a tour - never trusts a
// client-supplied attendee identity, always derives it from the session
// (same principle as the chat feature's create-post handler).
export const signUpForTour = async (req, res) => {
  const tour = await Tour.findById(req.params.tourId);
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }

  const existing = await Reservation.findOne({
    tour: tour._id,
    bookedBy: req.user._id,
  });
  if (existing) {
    throw new AppError('Már jelentkeztél erre a táborra.', 400);
  }

  const reservations = await Reservation.find({ tour: tour._id });
  const participantCount = reservations.reduce(
    (sum, r) => sum + r.attendees.length,
    0,
  );
  if (participantCount >= tour.maxCapacity) {
    throw new AppError('Ez a tábor sajnos megtelt.', 400);
  }

  const reservation = await Reservation.create({
    tour: tour._id,
    bookedBy: req.user._id,
    attendees: [{ user: req.user._id, name: req.user.name }],
  });

  res.status(201).json({ status: 'success', data: { reservation } });
};
