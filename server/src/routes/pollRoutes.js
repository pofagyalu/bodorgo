import express from 'express';
import * as pollController from '../controllers/pollController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';

const router = express.Router();

// requireAuth only (no restrictTo) - any logged-in role can view and vote,
// same "logged in, that's it" bar as the tour gallery/documents routes.
// Only create/edit/delete are admin-only.
router
  .route('/')
  .get(requireAuth, pollController.getAllPolls)
  .post(requireAuth, restrictTo('admin'), pollController.createPoll);

router
  .route('/:id')
  .get(requireAuth, pollController.getPoll)
  .patch(requireAuth, restrictTo('admin'), pollController.updatePoll)
  .delete(requireAuth, restrictTo('admin'), pollController.deletePoll);

router.route('/:id/vote').post(requireAuth, pollController.voteOnPoll);

export default router;
