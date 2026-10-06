import express from 'express';
import * as songController from '../controllers/songController.js';
import * as songListController from '../controllers/songListController.js';
import requireAuth from '../auth/requireAuth.js';

// Daloskönyv (the songbook): reading and adding for anyone logged in -
// guests too; changing and deleting a song for its owner and for the
// book's keeper, the role manager (see songController.js).
const router = express.Router();

router
  .route('/')
  .get(requireAuth, songController.getSongs)
  .post(requireAuth, songController.createSong);

// The whole book as a PDF, and its cover as a small picture - before
// /:slug, so they aren't taken for a song.
router.get('/book.pdf', requireAuth, songController.getSongBook);
router.get('/book.webp', requireAuth, songController.getSongBookPreview);
// The caller's own playlists (songListController.js) - before /:slug and
// /:id too, so "lists" isn't taken for a song.
router
  .route('/lists')
  .get(requireAuth, songListController.getSongLists)
  .post(requireAuth, songListController.createSongList);
router
  .route('/lists/:id')
  .patch(requireAuth, songListController.updateSongList)
  .delete(requireAuth, songListController.deleteSongList);

// Every song's words, for the search - before /:slug as well.
router.get('/lyrics', requireAuth, songController.getLyrics);

router.get('/:slug', requireAuth, songController.getSong);
// One song alone as a PDF - its page of the book.
router.get('/:slug/pdf', requireAuth, songController.getSongPdf);

router
  .route('/:id')
  .patch(requireAuth, songController.updateSong)
  .delete(requireAuth, songController.deleteSong);

export default router;
