import express from 'express';
import * as reviewController from '../review/review.controller.js';
import * as authController from '../user/auth.controller.js';

const router = express.Router({ mergeParams: true });

router
  .route('/')
  .get(reviewController.getAllReviews)
  .post(
    authController.protect,
    authController.restrictTo('user'),
    reviewController.createReview,
  );

export default router;
