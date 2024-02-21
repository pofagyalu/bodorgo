import express from 'express';
import * as tourController from '../tour/tour.controller.js';
import * as authController from '../auth/auth.controller.js';
import reviewRouter from './review.routes.js';

const router = express.Router();

router.use('/:tourId/reviews', reviewRouter);

router
  .route('/top-3-cheap')
  .get(tourController.aliasTopTours, tourController.getAllTours);

router.route('/tour-stats').get(tourController.getTourStats);
router
  .route('/monthly-plan/:year')
  .get(
    authController.protect,
    authController.restrictTo('admin'),
    tourController.getMonthlyPlan,
  );

router
  .route('/')
  .get(tourController.getAllTours)
  .post(
    authController.protect,
    authController.restrictTo('user', 'admin'),
    tourController.createTour,
  );

router
  .route('/:id')
  .get(tourController.getTour)
  .patch(
    authController.protect,
    authController.restrictTo('admin'),
    tourController.updateTour,
  )
  .delete(
    authController.protect,
    authController.restrictTo('admin'),
    tourController.deleteTour,
  );

export default router;
