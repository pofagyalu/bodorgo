import express from 'express';
import {
  getBarionSettings,
  getPaymentMethods,
  updatePaymentMethod,
  getBirthdaySettings,
  getRankSettings,
  getPresident,
  getPresidentSeal,
  getChatImageSettings,
  getImageCacheSettings,
  clearImageCacheNow,
  getMembershipFees,
  getMembershipReminder,
  testMembershipReminder,
  updateMembershipFees,
  updateBarionWallet,
  updateBirthdaySettings,
  updateRankSettings,
  updatePresident,
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

// Fizetési módok: which gateways are on and their fees - anyone logged in
// reads them (the pay dialogs), admins set them.
router.get('/payment-methods', requireAuth, getPaymentMethods);
router.put('/payment-methods/:method', requireAuth, restrictTo('admin'), updatePaymentMethod);

// Születésnap: the birthday greeting - admins only.
router
  .route('/birthday')
  .get(requireAuth, restrictTo('admin'), getBirthdaySettings)
  .put(requireAuth, restrictTo('admin'), updateBirthdaySettings);

// Rangok ünneplése: the celebration of a newly reached rank - admins only.
router
  .route('/rank')
  .get(requireAuth, restrictTo('admin'), getRankSettings)
  .put(requireAuth, restrictTo('admin'), updateRankSettings);

// Elnök: named, with the wax seal, on a tour's beszámoló - admins only.
router
  .route('/president')
  .get(requireAuth, restrictTo('admin'), getPresident)
  .put(requireAuth, restrictTo('admin'), updatePresident);
router.get('/president/seal.png', requireAuth, restrictTo('admin'), getPresidentSeal);

export default router;
