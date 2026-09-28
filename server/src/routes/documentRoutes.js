import express from 'express';
import {
  deleteDocument,
  getDocumentFile,
  getDocumentPreview,
  getDocuments,
  getLegacyTourDocument,
  uploadDocument,
  uploadMiddleware,
} from '../controllers/documentController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';

// Klub → Dokumentumok and every tour's Extrák (see documentController.js).
const router = express.Router();

router
  .route('/')
  .get(requireAuth, getDocuments)
  .post(requireAuth, restrictTo('admin'), uploadMiddleware, uploadDocument);
router.delete('/:id', requireAuth, restrictTo('admin'), deleteDocument);
router.get('/:id/file', requireAuth, getDocumentFile);
router.get('/:id/preview', requireAuth, getDocumentPreview);
// Old tour-document links (before tour documents moved here).
router.get('/tours/:tourId/:filename', requireAuth, getLegacyTourDocument);

export default router;
