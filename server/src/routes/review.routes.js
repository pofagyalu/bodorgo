import express from 'express';
import * as reviewController from '../review/review.controller';
import * as authController from '../auth/auth.controller';

const router = express.Router({ mergeParams: true });

router.use(authController.authUser);

router
  .route('/')
  .get(reviewController.getAllReviews)
  .post(reviewController.setTourUserIds, reviewController.createReview);

router
  .route('/:id')
  .get(reviewController.getReview)
  .patch(
    authController.restrictTo('user', 'admin'),
    reviewController.updateReview,
  )
  .delete(
    authController.restrictTo('user', 'admin'),
    reviewController.deleteReview,
  );

export default router;
