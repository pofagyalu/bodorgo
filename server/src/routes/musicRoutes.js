import express from 'express';
import {
  getPlaylist,
  getTrackImage,
  playlistAccess,
  refreshPlaylist,
  streamTrack,
} from '../controllers/musicController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';

// The music (see musicController.js), by playlist: Bódorgó FM for anyone
// logged in, Buli for members and admins.
const router = express.Router();
router.use(requireAuth);

router.get('/:key/playlist', playlistAccess, getPlaylist);
router.post('/:key/refresh', restrictTo('admin'), playlistAccess, refreshPlaylist);
router.get('/:key/stream/:itemId', playlistAccess, streamTrack);
router.get('/:key/image/:itemId', playlistAccess, getTrackImage);

export default router;
