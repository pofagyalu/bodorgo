import express from 'express';
import {
  getMembershipFees,
  getMembershipReminder,
  testMembershipReminder,
  updateMembershipFees,
  updateMembershipReminder,
} from '../controllers/settingsController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';

// Klub → Beállítások (see settingsController.js).
const router = express.Router();

router
  .route('/membership-fees')
  .get(requireAuth, restrictTo('admin', 'member'), getMembershipFees)
  .put(requireAuth, restrictTo('admin'), updateMembershipFees);

// Tagdíj emlékeztető - admins only.
router
  .route('/membership-reminder')
  .get(requireAuth, restrictTo('admin'), getMembershipReminder)
  .put(requireAuth, restrictTo('admin'), updateMembershipReminder);
router
  .route('/membership-reminder/test')
  .post(requireAuth, restrictTo('admin'), testMembershipReminder);

export default router;
