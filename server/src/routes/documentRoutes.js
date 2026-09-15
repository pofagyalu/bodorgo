import express from 'express';
import { getDocument } from '../controllers/documentController.js';
import requireAuth from '../auth/requireAuth.js';

const router = express.Router();

router.get('/:filename', requireAuth, getDocument);

export default router;
