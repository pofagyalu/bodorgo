import express from 'express';
import { getPlaylist, getTrackImage, streamTrack } from '../controllers/musicController.js';
import requireAuth from '../auth/requireAuth.js';

// The background music player (see musicController.js) - anyone logged in.
const router = express.Router();
router.use(requireAuth);

router.get('/playlist', getPlaylist);
router.get('/stream/:itemId', streamTrack);
router.get('/image/:itemId', getTrackImage);

export default router;
