import express from 'express';
import * as pollController from '../controllers/pollController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';

const router = express.Router();

// requireAuth only (no restrictTo) - any logged-in role can view and vote,
// same "logged in, that's it" bar as the tour gallery/documents routes.
// Creating from here and editing are admin-only; closing and deleting are
// for whoever started the poll or an admin (checked in pollController.js).
// Starting a poll from a tour's chat is POST /tours/:tourId/polls.
router
  .route('/')
  .get(requireAuth, pollController.getAllPolls)
  .post(requireAuth, restrictTo('admin'), pollController.createPoll);

router.get('/pending', requireAuth, pollController.getPendingCount);

router
  .route('/:id')
  .get(requireAuth, pollController.getPoll)
  .patch(requireAuth, restrictTo('admin'), pollController.updatePoll)
  .delete(requireAuth, pollController.deletePoll);

router.post('/:id/close', requireAuth, pollController.closePoll);
router.route('/:id/vote').post(requireAuth, pollController.voteOnPoll);

export default router;
