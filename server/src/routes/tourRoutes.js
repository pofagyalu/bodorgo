import express from 'express';
import * as tourController from '../controllers/tourController.js';
import { signUpForTour, updateAttendeeNights, updateAttendeeFeeExempt } from '../controllers/reservationController.js';
import * as tourImageController from '../controllers/tourImageController.js';
import * as reviewController from '../controllers/reviewController.js';
import { downloadTourPdf, emailTourPdf, emailTourPdfToAttendees } from '../controllers/tourPdfController.js';
import { downloadAttendeesExcel } from '../controllers/tourExcelController.js';
import {
  loadTourForUpload,
  uploadMiddleware,
  uploadTourDocument,
  deleteTourDocument,
} from '../controllers/tourDocumentController.js';
import {
  loadTourForCoverUpload,
  uploadCoverMiddleware,
  uploadTourCover,
  uploadCoverForOrderMiddleware,
  uploadCoverForOrder,
} from '../controllers/tourCoverController.js';
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

// requireAuth (not restrictTo - any logged-in role) - each copy is
// stamped with the downloader's own name in the footer, so there has to
// be a real logged-in user to attribute it to.
router.route('/:id/pdf').get(requireAuth, downloadTourPdf);
router.route('/:id/pdf/email').post(requireAuth, emailTourPdf);
router.route('/:id/pdf/email-attendees').post(requireAuth, restrictTo('admin'), emailTourPdfToAttendees);
router.route('/:id/attendees/export.xlsx').get(requireAuth, restrictTo('admin'), downloadAttendeesExcel);

// Cover image - admin-only upload, replacing the old "type the filename
// by hand" workflow. Viewing is the same plain, unauthenticated static
// file URL under public/img/tours/ as always (see tour-details.html), so
// no GET route is needed here.
router
  .route('/:id/cover')
  .post(requireAuth, restrictTo('admin'), loadTourForCoverUpload, uploadCoverMiddleware, uploadTourCover);
// Pre-creation cover upload (see tourCoverController.js's own comment) -
// a plain "cover" first-segment, not "/:id/cover" above, so it can never
// collide with a real tour id.
router
  .route('/cover/:order')
  .post(requireAuth, restrictTo('admin'), uploadCoverForOrderMiddleware, uploadCoverForOrder);

// Extra infók - admin-only upload/delete; viewing is a plain static file
// URL under public/documents/tours/ (see tourDocumentController.js), same
// unauthenticated-but-unlisted precedent as tour cover images, so no GET
// route is needed here at all.
router
  .route('/:tourId/documents')
  .post(requireAuth, restrictTo('admin'), loadTourForUpload, uploadMiddleware, uploadTourDocument);
router.route('/:tourId/documents/:documentId').delete(requireAuth, restrictTo('admin'), deleteTourDocument);

router.route('/:tourId/signup').post(requireAuth, signUpForTour);
router
  .route('/:tourId/reservations/:reservationId/attendees/:attendeeId/nights')
  .patch(requireAuth, restrictTo('admin'), updateAttendeeNights);
router
  .route('/:tourId/reservations/:reservationId/attendees/:attendeeId/fee-exempt')
  .patch(requireAuth, restrictTo('admin'), updateAttendeeFeeExempt);

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
router
  .route('/:tourId/images/:filename')
  .get(requireAuth, tourImageController.getTourImage)
  .patch(requireAuth, restrictTo('admin'), tourImageController.setImageRestricted);

// Reviews - requireAuth only, not restrictTo('admin')/anything role-based;
// the actual "who's allowed" check is attendance-based, enforced inside
// reviewController.js since it needs a per-tour Reservation lookup that a
// static route-level role check can't express.
router.route('/:tourId/reviews').put(requireAuth, reviewController.submitReview);
router.route('/:tourId/reviews/me').get(requireAuth, reviewController.getMyReview);

export default router;
