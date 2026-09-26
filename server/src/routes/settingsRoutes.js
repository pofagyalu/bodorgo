import express from 'express';
import { getMembershipFees, updateMembershipFees } from '../controllers/settingsController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';

// Klub → Beállítások (see settingsController.js).
const router = express.Router();

router
  .route('/membership-fees')
  .get(requireAuth, restrictTo('admin', 'member'), getMembershipFees)
  .put(requireAuth, restrictTo('admin'), updateMembershipFees);

export default router;
