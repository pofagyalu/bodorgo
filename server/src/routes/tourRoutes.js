import express from 'express';
import * as tourController from '../controllers/tourController.js';
import { signUpForTour, updateAttendeeNights, updateAttendeeFeeExempt } from '../controllers/reservationController.js';
import * as tourImageController from '../controllers/tourImageController.js';
import { getTourVideo, getTourVideoCover, getTourVideoSubtitles } from '../controllers/tourVideoController.js';
import * as reviewController from '../controllers/reviewController.js';
import { downloadTourPdf, emailTourPdf, emailTourPdfToAttendees } from '../controllers/tourPdfController.js';
import { downloadAttendeesExcel } from '../controllers/tourExcelController.js';
import {
  loadTourForUpload,
  uploadMiddleware,
  uploadTourDocument,
  deleteTourDocument,
} from '../controllers/tourDocumentController.js';
import { uploadCoverMiddleware, uploadTourCover, getTourCover } from '../controllers/tourCoverController.js';
import { updateAccommodation } from '../controllers/accommodationController.js';
import { getRoomBoard, assignRoom, setFinalized } from '../controllers/roomAllocationController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';

const router = express.Router();

// Everything about tours needs a login - it's a members-only app. The one
// exception is /ticker: just the next (or latest) tour's number, title,
// place and date for the logged-out landing page's scrolling ticker.
router.route('/ticker').get(tourController.getTicker);

router
  .route('/last-3')
  .get(requireAuth, tourController.aliasLastTours, tourController.getAlltours);

router.route('/tour-stats').get(requireAuth, tourController.getTourStats);
router.route('/montly-plan/:year').get(requireAuth, tourController.getMonthlyPlan);

router
  .route('/')
  .get(requireAuth, tourController.getAlltours)
  .post(requireAuth, restrictTo('admin'), tourController.createTour);

router
  .route('/:id')
  .get(requireAuth, tourController.getTour)
  .patch(requireAuth, restrictTo('admin'), tourController.updateTour)
  .delete(requireAuth, restrictTo('admin'), tourController.deleteTour);

// requireAuth (not restrictTo - any logged-in role) - each copy is
// stamped with the downloader's own name in the footer, so there has to
// be a real logged-in user to attribute it to.
router.route('/:id/pdf').get(requireAuth, downloadTourPdf);
router.route('/:id/pdf/email').post(requireAuth, emailTourPdf);
router.route('/:id/pdf/email-attendees').post(requireAuth, restrictTo('admin'), emailTourPdfToAttendees);
router.route('/:id/attendees/export.xlsx').get(requireAuth, restrictTo('admin'), downloadAttendeesExcel);

// Cover image - stored in the database (see tourCoverModel.js), viewable
// by any logged-in user, uploadable by an admin.
router
  .route('/:id/cover')
  .get(requireAuth, getTourCover)
  .post(requireAuth, restrictTo('admin'), uploadCoverMiddleware, uploadTourCover);

// Szállás (houses -> rooms -> places) - saved on its own, separately from
// the rest of the tour (see accommodationController.js). Read as part of
// GET /tours/:id.
router.route('/:id/accommodation').put(requireAuth, restrictTo('admin'), updateAccommodation);

// Szobabeosztás (who sleeps where) - see roomAllocationController.js.
router.route('/:id/rooms').get(requireAuth, getRoomBoard);
router.route('/:id/rooms/assignment').put(requireAuth, restrictTo('admin'), assignRoom);
router.route('/:id/rooms/finalized').put(requireAuth, restrictTo('admin'), setFinalized);

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
  .route('/:tourId/schedule/:eventId/participants')
  .patch(requireAuth, tourController.updateScheduleEventParticipants);

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

// Post-tour recap video(s), matched by tour number (see
// utils/tourVideos.js) - same "logged in, that's it, no role restriction"
// bar as the gallery routes above. :videoId is one of the ids getTour
// lists in `videos`.
router.route('/:tourId/videos/:videoId/video').get(requireAuth, getTourVideo);
router.route('/:tourId/videos/:videoId/cover').get(requireAuth, getTourVideoCover);
router.route('/:tourId/videos/:videoId/subtitles.vtt').get(requireAuth, getTourVideoSubtitles);

// Reviews - requireAuth only, not restrictTo('admin')/anything role-based;
// the actual "who's allowed" check is attendance-based, enforced inside
// reviewController.js since it needs a per-tour Reservation lookup that a
// static route-level role check can't express.
router.route('/:tourId/reviews').put(requireAuth, reviewController.submitReview);
router.route('/:tourId/reviews/me').get(requireAuth, reviewController.getMyReview);

export default router;
