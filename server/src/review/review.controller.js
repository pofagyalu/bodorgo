import Review from './review.model.js';
import Tour from '../tour/tour.model.js';
import catchAsync from '../utils/catch-async.js';
import AppError from '../utils/app-error.js';
import factory from '../middlewares/handler-factory.js';

export const getAllReviews = catchAsync(async (req, res, next) => {
  let filter = {};
  if (req.params.tourId) {
    filter = { tour: req.params.tourId };
  }
  const reviews = await Review.find(filter);

  res.status(200).json({
    status: 'success',
    results: reviews.length,
    data: {
      reviews,
    },
  });
});

export const createReview = catchAsync(async (req, res, next) => {
  const { tourId } = req.params;
  const tour = Tour.findById(tourId);

  if (!tour) {
    return next(new AppError('No tour found with that ID', 400));
  }
  const newReview = await Review.create({
    tour: tourId,
    ...req.body,
    user: req.currentUser.id,
  });

  res.status(201).json({
    status: 'success',
    data: {
      review: newReview,
    },
  });
});

export const deleteReview = factory.deleteOne(Review);
