import Review from './review.model.js';
import Tour from '../tour/tour.model.js';
import catchAsync from '../utils/catch-async.js';
import AppError from '../utils/app-error.js';
import factory from '../middlewares/handler-factory.js';

export const setTourUserIds = catchAsync(async (req, res, next) => {
  const { tourId } = req.params;
  const tour = await Tour.findById(tourId);

  if (!tour) {
    return next(new AppError('No tour found with that ID', 400));
  }

  req.body.user = req.currentUser.id;
  req.body.tour = tourId;

  next();
});

export const getAllReviews = factory.getAll(Review, {
  paramName: 'tourId',
  foreignField: 'tour',
});
export const getReview = factory.getOne(Review);
export const createReview = factory.createOne(Review);
export const updateReview = factory.updateOne(Review);
export const deleteReview = factory.deleteOne(Review);
