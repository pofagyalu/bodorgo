import express from 'express';
import {
  getMediaVideo,
  getMediaVideoCategoryCover,
  getMediaVideoCover,
  getMediaVideoSubtitles,
  listMediaVideos,
  listSmallCopyJobs,
  removeMediaVideoSmall,
  startMediaVideoSmall,
  updateMediaVideo,
} from '../controllers/mediaVideoController.js';
import {
  getMediaDiscovery,
  downloadMediaPhoto,
  getMediaPhoto,
  getMediaPhotoThumb,
  listMediaAlbumPhotos,
  listMediaPhotos,
  startMediaDiscovery,
  updateMediaPhoto,
  updateMediaPhotoAlbum,
  updateMediaPhotoCategory,
} from '../controllers/mediaPhotoController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';
import { mediaEditorOnly } from '../utils/mediaAccess.js';

// The Média page (videos and photos) - members only.
const router = express.Router();
router.use(requireAuth, restrictTo('admin', 'member'));

router.get('/videos', listMediaVideos);
router.get('/videos/:category/cover', getMediaVideoCategoryCover);
router.patch('/videos/:category/:id', mediaEditorOnly, updateMediaVideo);
router.get('/videos/:category/:id/video', getMediaVideo);
router.get('/videos/:category/:id/cover', getMediaVideoCover);
router.get('/videos/:category/:id/subtitles.vtt', getMediaVideoSubtitles);
// The small copies (utils/videoCopies.js) - made and removed by admins.
router.get('/videos/small-copies', restrictTo('admin'), listSmallCopyJobs);
router.post('/videos/:category/:id/small', restrictTo('admin'), startMediaVideoSmall);
router.delete('/videos/:category/:id/small', restrictTo('admin'), removeMediaVideoSmall);

router.get('/photos', listMediaPhotos);
router.get('/photos/:category/:filename/thumb', getMediaPhotoThumb);
router.get('/photos/:category/:filename/download', downloadMediaPhoto);
router.get('/photos/:category/:filename', getMediaPhoto);
router.patch('/photos/:category/:filename', mediaEditorOnly, updateMediaPhoto);
router.patch('/photos/:category', mediaEditorOnly, updateMediaPhotoCategory);
// A category's albums: the folders inside its folder.
router.get('/photo-albums/:category/:album', listMediaAlbumPhotos);
router.patch('/photo-albums/:category/:album', mediaEditorOnly, updateMediaPhotoAlbum);

// "Új média felfedezése" - admins only (tour albums and Média photos).
router.get('/discover', restrictTo('admin'), getMediaDiscovery);
router.post('/discover', restrictTo('admin'), startMediaDiscovery);

export default router;
