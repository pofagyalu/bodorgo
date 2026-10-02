import express from 'express';
import {
  getMediaVideo,
  getMediaVideoCategoryCover,
  getMediaVideoCover,
  getMediaVideoSubtitles,
  listMediaVideos,
  updateMediaVideoTitle,
} from '../controllers/mediaVideoController.js';
import {
  getMediaDiscovery,
  downloadMediaPhoto,
  getMediaPhoto,
  getMediaPhotoThumb,
  listMediaPhotos,
  startMediaDiscovery,
} from '../controllers/mediaPhotoController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';

// The Média page (videos and photos) - members only.
const router = express.Router();
router.use(requireAuth, restrictTo('admin', 'member'));

router.get('/videos', listMediaVideos);
router.get('/videos/:category/cover', getMediaVideoCategoryCover);
router.patch('/videos/:category/:id', restrictTo('admin'), updateMediaVideoTitle);
router.get('/videos/:category/:id/video', getMediaVideo);
router.get('/videos/:category/:id/cover', getMediaVideoCover);
router.get('/videos/:category/:id/subtitles.vtt', getMediaVideoSubtitles);

router.get('/photos', listMediaPhotos);
router.get('/photos/:category/:filename/thumb', getMediaPhotoThumb);
router.get('/photos/:category/:filename/download', downloadMediaPhoto);
router.get('/photos/:category/:filename', getMediaPhoto);

// "Új média felfedezése" - admins only (tour albums and Média photos).
router.get('/discover', restrictTo('admin'), getMediaDiscovery);
router.post('/discover', restrictTo('admin'), startMediaDiscovery);

export default router;
