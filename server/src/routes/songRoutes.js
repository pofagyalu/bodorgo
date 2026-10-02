import express from 'express';
import * as songController from '../controllers/songController.js';
import requireAuth from '../auth/requireAuth.js';

// Daloskönyv (the songbook): reading for anyone logged in - guests too;
// writing only for the role manager (see songController.js).
const router = express.Router();
const editor = [requireAuth, songController.requireSongEditor];

router.route('/').get(requireAuth, songController.getSongs).post(editor, songController.createSong);

// The whole book as a PDF, and its cover as a small picture - before
// /:slug, so they aren't taken for a song.
router.get('/book.pdf', requireAuth, songController.getSongBook);
router.get('/book.webp', requireAuth, songController.getSongBookPreview);

router.get('/:slug', requireAuth, songController.getSong);

router
  .route('/:id')
  .patch(editor, songController.updateSong)
  .delete(editor, songController.deleteSong);

export default router;
