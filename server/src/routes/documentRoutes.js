import express from 'express';
import { getDocument } from '../controllers/documentController.js';
import {
  getClubDocuments,
  uploadMiddleware,
  uploadClubDocument,
  deleteClubDocument,
} from '../controllers/clubDocumentController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';

const router = express.Router();

router.get('/', requireAuth, getClubDocuments);
router.post('/', requireAuth, restrictTo('admin'), uploadMiddleware, uploadClubDocument);
router.delete('/:id', requireAuth, restrictTo('admin'), deleteClubDocument);
router.get('/:filename', requireAuth, getDocument);

export default router;
