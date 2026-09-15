import express from 'express';
import * as tourController from '../controllers/tourController.js';
import { signUpForTour } from '../controllers/reservationController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';

const router = express.Router();

router
  .route('/last-3')
  .get(tourController.aliasLastTours, tourController.getAlltours);

router.route('/tour-stats').get(tourController.getTourStats);
router.route('/montly-plan/:year').get(tourController.getMonthlyPlan);

router
  .route('/')
  .get(tourController.getAlltours) // public: browsing tours needs no login
  .post(tourController.createTour);

router
  .route('/:id')
  .get(tourController.getTour)
  .patch(tourController.updateTour)
  .delete(requireAuth, restrictTo('admin'), tourController.deleteTour);

router.route('/:tourId/signup').post(requireAuth, signUpForTour);

router
  .route('/:tourId/schedule/:eventId/toggle-participation')
  .post(requireAuth, tourController.toggleScheduleParticipation);

router
  .route('/:tourId/schedule')
  .post(requireAuth, restrictTo('admin'), tourController.createScheduleEvent);

router
  .route('/:tourId/schedule/:eventId')
  .patch(requireAuth, restrictTo('admin'), tourController.updateScheduleEvent);

export default router;
