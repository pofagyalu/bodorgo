import mongoose from 'mongoose';
import AppError from './appError.js';
import Reservation from '../models/reservationModel.js';

// A tour's album and its recap videos (Tábori videók) are the members' and
// the admins' - and a guest's only on a tour they are on themselves (the
// same "is this user among the tour's attendees" as a restricted photo's -
// tourImageController.js).
export async function canSeeTourMedia(user, tourId) {
  if (user.role !== 'guest') return true;
  if (!mongoose.isValidObjectId(tourId)) return false;
  return !!(await Reservation.exists({ tour: tourId, 'attendees.user': user._id }));
}

// For the routes with :tourId that give a photo or a video (tourRoutes.js).
export const tourMediaAccess = async (req, res, next) => {
  if (await canSeeTourMedia(req.user, req.params.tourId)) return next();
  next(new AppError('A tábor fotóit és videóit vendégként csak a résztvevői láthatják.', 403));
};
