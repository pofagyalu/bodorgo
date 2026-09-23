import express from 'express';
import { getMembers } from '../controllers/membershipController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';

const router = express.Router();

router.get('/users', requireAuth, restrictTo('admin', 'member'), getMembers);

export default router;
