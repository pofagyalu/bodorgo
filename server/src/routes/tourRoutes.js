import express from 'express';
import * as tourController from '../controllers/tourController.js';
import {
  signUpForTour,
  updateAttendeeNights,
  updateAttendeeFeeExempt,
  withdrawAttendee,
  getCancellations,
} from '../controllers/reservationController.js';
import * as tourImageController from '../controllers/tourImageController.js';
import {
  getTourVideo,
  getTourVideoCover,
  getTourVideoSubtitles,
  removeTourVideoSmall,
  startTourVideoSmall,
} from '../controllers/tourVideoController.js';
import * as reviewController from '../controllers/reviewController.js';
import { downloadTourPdf, emailTourPdf } from '../controllers/tourPdfController.js';
import {
  downloadReportPdf,
  finishReport,
  getReport,
  reopenReport,
  saveReport,
} from '../controllers/tourReportController.js';
import {
  getReportJson,
  hideReportNames,
  showReportNames,
} from '../controllers/tourReportJsonController.js';
import {
  getMailings,
  saveDraft,
  sendTest,
  sendToAttendees,
} from '../controllers/mailingController.js';
import { createTourPoll } from '../controllers/pollController.js';
import {
  getChatBackground,
  getChatBackgroundImage,
  getTourChatRoom,
  nextChatBackground,
} from '../controllers/chatImageController.js';
import { downloadAttendeesExcel } from '../controllers/tourExcelController.js';
import {
  uploadCoverMiddleware,
  uploadTourCover,
  getTourCover,
} from '../controllers/tourCoverController.js';
import { updateAccommodation } from '../controllers/accommodationController.js';
import { getRoomBoard, assignRoom, setFinalized } from '../controllers/roomAllocationController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';
import { tourOpen, tourReportOpen } from '../utils/tourClosed.js';
import { tourMediaAccess } from '../utils/tourMediaAccess.js';

const router = express.Router();

// Everything about tours needs a login - it's a members-only app. The one
// exception is /ticker: just the next (or latest) tour's number, title,
// place and date for the logged-out landing page's scrolling ticker.
router.route('/ticker').get(tourController.getTicker);

router.route('/last-3').get(requireAuth, tourController.aliasLastTours, tourController.getAlltours);

router.route('/years').get(requireAuth, tourController.getTourYears);
router.route('/tour-stats').get(requireAuth, tourController.getTourStats);
router.route('/montly-plan/:year').get(requireAuth, tourController.getMonthlyPlan);

router
  .route('/')
  .get(requireAuth, tourController.getAlltours)
  .post(requireAuth, restrictTo('admin'), tourController.createTour);

router
  .route('/:id')
  .get(requireAuth, tourController.getTour)
  .patch(requireAuth, restrictTo('admin'), tourOpen, tourController.updateTour)
  .delete(requireAuth, restrictTo('admin'), tourOpen, tourController.deleteTour);

// Lezárás: the tour is finished for good. From then on every route below
// that changes the tour answers 403 (tourOpen - utils/tourClosed.js); what
// only reads it, and the members' own reviews, stay - and the beszámoló
// can still be written until it's Kész (tourReportOpen).
router.route('/:id/close').post(requireAuth, restrictTo('admin'), tourController.closeTour);

// requireAuth (not restrictTo - any logged-in role) - each copy is
// stamped with the downloader's own name in the footer, so there has to
// be a real logged-in user to attribute it to.
router.route('/:id/pdf').get(requireAuth, downloadTourPdf);
router.route('/:id/pdf/email').post(requireAuth, emailTourPdf);
// Beszámoló (see tourReportController.js): written by an admin, day by
// day; once Kész, the tour's attendees download it as a PDF.
router
  .route('/:id/report')
  .get(requireAuth, getReport)
  .put(requireAuth, restrictTo('admin'), tourReportOpen, saveReport);
router
  .route('/:id/report/finish')
  .post(requireAuth, restrictTo('admin'), tourReportOpen, finishReport);
router.route('/:id/report/reopen').post(requireAuth, restrictTo('admin'), tourOpen, reopenReport);
router.route('/:id/report/pdf').get(requireAuth, downloadReportPdf);
// The beszámoló as data for an AI model, its people as aliases - and the
// swap of names and aliases in a question and an answer (see
// tourReportJsonController.js).
router.route('/:id/report/json').get(requireAuth, restrictTo('admin'), getReportJson);
router.route('/report-names/hide').post(requireAuth, restrictTo('admin'), hideReportNames);
router.route('/report-names/show').post(requireAuth, restrictTo('admin'), showReportNames);
// Letters to the tour's attendees (admin) - see mailingController.js.
router.route('/:id/mailings').get(requireAuth, restrictTo('admin'), getMailings);
router.route('/:id/mailings/draft').put(requireAuth, restrictTo('admin'), tourOpen, saveDraft);
router.route('/:id/mailings/test').post(requireAuth, restrictTo('admin'), tourOpen, sendTest);
router
  .route('/:id/mailings/send')
  .post(requireAuth, restrictTo('admin'), tourOpen, sendToAttendees);
router
  .route('/:id/attendees/export.xlsx')
  .get(requireAuth, restrictTo('admin'), downloadAttendeesExcel);

// Cover image - stored in the database (see tourCoverModel.js), viewable
// by any logged-in user, uploadable by an admin.
router
  .route('/:id/cover')
  .get(requireAuth, getTourCover)
  .post(requireAuth, restrictTo('admin'), tourOpen, uploadCoverMiddleware, uploadTourCover);

// Szállás (houses -> rooms -> places) - saved on its own, separately from
// the rest of the tour (see accommodationController.js). Read as part of
// GET /tours/:id.
router
  .route('/:id/accommodation')
  .put(requireAuth, restrictTo('admin'), tourOpen, updateAccommodation);

// Szobabeosztás (who sleeps where) - see roomAllocationController.js.
router.route('/:id/rooms').get(requireAuth, getRoomBoard);
router.route('/:id/rooms/assignment').put(requireAuth, restrictTo('admin'), tourOpen, assignRoom);
router.route('/:id/rooms/finalized').put(requireAuth, restrictTo('admin'), tourOpen, setFinalized);

// Extrák documents are uploaded, served and deleted with the club's own
// documents - see documentRoutes.js (POST /documents with a tour).

router.route('/:tourId/signup').post(requireAuth, tourOpen, signUpForTour);
router
  .route('/:tourId/reservations/:reservationId/attendees/:attendeeId/nights')
  .patch(requireAuth, restrictTo('admin'), tourOpen, updateAttendeeNights);
router
  .route('/:tourId/reservations/:reservationId/attendees/:attendeeId/fee-exempt')
  .patch(requireAuth, restrictTo('admin'), tourOpen, updateAttendeeFeeExempt);
// "Lemondás" - taking one person off the tour (see withdrawAttendee for
// who may withdraw whom), and the admins' list of them.
router
  .route('/:tourId/reservations/:reservationId/attendees/:attendeeId')
  .delete(requireAuth, tourOpen, withdrawAttendee);
router.route('/:tourId/cancellations').get(requireAuth, restrictTo('admin'), getCancellations);
// A poll started from the tour's chat - by any attendee (see pollController.js).
router.route('/:tourId/polls').post(requireAuth, createTourPoll);
// The tour's own chat room (made on first use - see chat/chatRooms.js).
router.route('/:tourId/chat-room').get(requireAuth, getTourChatRoom);
// The Kotyogó's background: this week's pale album photo; an admin can
// pick another.
router.route('/:tourId/chat/background').get(requireAuth, getChatBackground);
router.route('/:tourId/chat/background/image').get(requireAuth, getChatBackgroundImage);
router
  .route('/:tourId/chat/background/next')
  .post(requireAuth, restrictTo('admin'), nextChatBackground);

router
  .route('/:tourId/schedule/:eventId/participants')
  .patch(requireAuth, tourOpen, tourController.updateScheduleEventParticipants);

router
  .route('/:tourId/schedule')
  .post(requireAuth, restrictTo('admin'), tourOpen, tourController.createScheduleEvent);

router
  .route('/:tourId/schedule/:eventId')
  .patch(requireAuth, restrictTo('admin'), tourOpen, tourController.updateScheduleEvent)
  .delete(requireAuth, restrictTo('admin'), tourOpen, tourController.deleteScheduleEvent);

// Gallery routes - all requireAuth (see the root README's "Tour
// photos"): members and admins - a guest only on a tour they are on
// themselves (tourMediaAccess - utils/tourMediaAccess.js). The literal
// "download-zip" path must be registered before the generic "/:filename"
// one below it, or Express would match "download-zip" as a filename.
router
  .route('/:tourId/images')
  .get(requireAuth, tourMediaAccess, tourImageController.getTourImages);
router
  .route('/:tourId/images/download-zip')
  .get(requireAuth, tourMediaAccess, tourImageController.downloadTourImagesZip);
router
  .route('/:tourId/images/:filename/thumb')
  .get(requireAuth, tourMediaAccess, tourImageController.getTourImageThumb);
router
  .route('/:tourId/images/:filename/download')
  .get(requireAuth, tourMediaAccess, tourImageController.downloadTourImage);
router
  .route('/:tourId/images/:filename')
  .get(requireAuth, tourMediaAccess, tourImageController.getTourImage)
  .patch(requireAuth, restrictTo('admin'), tourOpen, tourImageController.setImageRestricted);

// Post-tour recap video(s), matched by tour number (see
// utils/tourVideos.js) - for the same people as the gallery routes above.
// :videoId is one of the ids getTour lists in `videos`.
router.route('/:tourId/videos/:videoId/video').get(requireAuth, tourMediaAccess, getTourVideo);
router.route('/:tourId/videos/:videoId/cover').get(requireAuth, tourMediaAccess, getTourVideoCover);
router
  .route('/:tourId/videos/:videoId/subtitles.vtt')
  .get(requireAuth, tourMediaAccess, getTourVideoSubtitles);
// A video's small copy (utils/videoCopies.js) - made and removed by admins.
router
  .route('/:tourId/videos/:videoId/small')
  .post(requireAuth, restrictTo('admin'), startTourVideoSmall)
  .delete(requireAuth, restrictTo('admin'), removeTourVideoSmall);

// Reviews - requireAuth only, not restrictTo('admin')/anything role-based;
// the actual "who's allowed" check is attendance-based, enforced inside
// reviewController.js since it needs a per-tour Reservation lookup that a
// static route-level role check can't express.
router.route('/:tourId/reviews').put(requireAuth, reviewController.submitReview);
router.route('/:tourId/reviews/me').get(requireAuth, reviewController.getMyReview);

export default router;
