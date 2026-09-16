import express from 'express';
import * as tourController from '../controllers/tourController.js';
import { signUpForTour } from '../controllers/reservationController.js';
import * as tourImageController from '../controllers/tourImageController.js';
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
  .post(requireAuth, restrictTo('admin'), tourController.createTour);

router
  .route('/:id')
  .get(tourController.getTour)
  .patch(requireAuth, restrictTo('admin'), tourController.updateTour)
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

// Gallery routes - all requireAuth (see
// tour-photos-implementation-plan.md), same "logged in, that's it, no
// role restriction" bar as the homepage documents. The literal
// "download-zip" path must be registered before the generic "/:filename"
// one below it, or Express would match "download-zip" as a filename.
router.route('/:tourId/images').get(requireAuth, tourImageController.getTourImages);
router
  .route('/:tourId/images/download-zip')
  .get(requireAuth, tourImageController.downloadTourImagesZip);
router
  .route('/:tourId/images/:filename/thumb')
  .get(requireAuth, tourImageController.getTourImageThumb);
router
  .route('/:tourId/images/:filename/download')
  .get(requireAuth, tourImageController.downloadTourImage);
router.route('/:tourId/images/:filename').get(requireAuth, tourImageController.getTourImage);

export default router;
