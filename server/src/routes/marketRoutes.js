import express from 'express';
import * as marketController from '../controllers/marketController.js';
import requireAuth from '../auth/requireAuth.js';

const router = express.Router();

// Ócskapiac: for everyone logged in, guests too. Who may change what is
// checked in marketController.js (an item is its owner's).
router.use(requireAuth);

router
  .route('/')
  .get(marketController.getMarketItems)
  .post(marketController.marketPhotoUpload, marketController.createMarketItem);

router.get('/new-count', marketController.getNewCount);

router
  .route('/:id')
  .get(marketController.getMarketItem)
  .patch(marketController.marketPhotoUpload, marketController.updateMarketItem)
  .delete(marketController.deleteMarketItem);

router.post('/:id/gone', marketController.markMarketItemGone);
router
  .route('/:id/want')
  .post(marketController.wantMarketItem)
  .delete(marketController.unwantMarketItem);
router
  .route('/:id/dibs')
  .post(marketController.dibsMarketItem)
  .delete(marketController.undibsMarketItem);
router.post('/:id/notes', marketController.addMarketNote);
router.delete('/:id/notes/:noteId', marketController.deleteMarketNote);
router.get('/:id/photos/:photoId', marketController.getMarketPhoto);
router.get('/:id/photos/:photoId/thumb', marketController.getMarketThumb);

export default router;
