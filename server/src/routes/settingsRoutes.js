import express from 'express';
import {
  getBarionSettings,
  getBirthdaySettings,
  getChatImageSettings,
  getImageCacheSettings,
  clearImageCacheNow,
  getMembershipFees,
  getMembershipReminder,
  testMembershipReminder,
  updateMembershipFees,
  updateBarionWallet,
  updateBirthdaySettings,
  updateChatImageSettings,
  updateImageCacheSettings,
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

// Chat photos: quota and daily limit - admins only.
router
  .route('/chat-images')
  .get(requireAuth, restrictTo('admin'), getChatImageSettings)
  .put(requireAuth, restrictTo('admin'), updateChatImageSettings);

// Kép gyorsítótár: its quota, and emptying it - admins only.
router
  .route('/image-cache')
  .get(requireAuth, restrictTo('admin'), getImageCacheSettings)
  .put(requireAuth, restrictTo('admin'), updateImageCacheSettings)
  .delete(requireAuth, restrictTo('admin'), clearImageCacheNow);

// Barion wallets: payees, API keys, bank accounts - admins only.
router.get('/barion', requireAuth, restrictTo('admin'), getBarionSettings);
router.put('/barion/:wallet', requireAuth, restrictTo('admin'), updateBarionWallet);

// Születésnap: the birthday greeting - admins only.
router
  .route('/birthday')
  .get(requireAuth, restrictTo('admin'), getBirthdaySettings)
  .put(requireAuth, restrictTo('admin'), updateBirthdaySettings);

export default router;
