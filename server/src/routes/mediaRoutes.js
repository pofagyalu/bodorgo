import express from 'express';
import {
  getMediaVideo,
  getMediaVideoCategoryCover,
  getMediaVideoCover,
  getMediaVideoSubtitles,
  listMediaVideos,
} from '../controllers/mediaVideoController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';

// The Média page (videos now, event photos later) - members only.
const router = express.Router();
router.use(requireAuth, restrictTo('admin', 'member'));

router.get('/videos', listMediaVideos);
router.get('/videos/:category/cover', getMediaVideoCategoryCover);
router.get('/videos/:category/:id/video', getMediaVideo);
router.get('/videos/:category/:id/cover', getMediaVideoCover);
router.get('/videos/:category/:id/subtitles.vtt', getMediaVideoSubtitles);

export default router;
