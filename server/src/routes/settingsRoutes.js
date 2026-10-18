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
  getYearlyReport,
  getYearlyReportPdf,
  testYearlyReport,
  updateMembershipFees,
  updateBarionWallet,
  updateBirthdaySettings,
  updateRankSettings,
  updatePresident,
  updateChatImageSettings,
  updateImageCacheSettings,
  updateMembershipReminder,
  getOidcSettingsView,
  updateOidcSettings,
  addOidcProvider,
  updateOidcProvider,
  deleteOidcProvider,
  setActiveOidcProvider,
} from '../controllers/settingsController.js';
import { getAuditLog } from '../controllers/auditLogController.js';
import { downloadLogFile, getLogFile, listLogFiles } from '../controllers/logFilesController.js';
import requireAuth, { restrictTo, roleManagerOnly } from '../auth/requireAuth.js';
import { requireFreshLogin } from '../auth/freshLogin.js';
import { weatherOutlookRules } from '../utils/weatherOutlook.js';

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

// Éves jelentés: the club's year on one page, e-mailed on 1 January -
// when it goes, to whom, how it looks now, and a try-out - admins only.
router.get('/yearly-report', requireAuth, restrictTo('admin'), getYearlyReport);
router.get('/yearly-report/preview.pdf', requireAuth, restrictTo('admin'), getYearlyReportPdf);
router.post('/yearly-report/test', requireAuth, restrictTo('admin'), testYearlyReport);

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
// Where a payout goes: only for someone who identified themselves in the
// last minutes (auth/freshLogin.js).
router.put(
  '/barion/:wallet',
  requireAuth,
  restrictTo('admin'),
  requireFreshLogin,
  updateBarionWallet,
);

// Napló: who did what and when, of what moves money, rights or the club's
// settings - admins only.
router.get('/audit-log', requireAuth, restrictTo('admin'), getAuditLog);

// Naplófájlok: the server's log files - the role manager's alone (they hold
// e-mail and IP addresses). No re-identifying: he wants to look at them any
// time.
const logFilesGuard = [requireAuth, roleManagerOnly];
router.get('/logs', ...logFilesGuard, listLogFiles);
router.get('/logs/:name', ...logFilesGuard, getLogFile);
router.get('/logs/:name/download', ...logFilesGuard, downloadLogFile);

// Fizetési módok: which gateways are on and their fees - anyone logged in
// reads them (the pay dialogs), admins set them.
// Életviteli tanácsok: the numbers the tours' weather outlook is worked
// out from, straight from the code (utils/weatherOutlookSettings.js) - to
// read on Beállítások → Infó. Nothing to set here.
router.get('/weather-outlook', requireAuth, (req, res) => {
  res.status(200).json({ status: 'success', data: weatherOutlookRules() });
});

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

// OIDC szolgáltató: where people log in - a wrong value locks everybody
// out, so the role manager only. Secrets go in, never out. Every change
// only by someone who identified themselves in the last minutes
// (auth/freshLogin.js): pointed at a provider of someone else's, a phone
// left logged in would hand them every account.
router
  .route('/oidc')
  .get(requireAuth, roleManagerOnly, getOidcSettingsView)
  .put(requireAuth, roleManagerOnly, requireFreshLogin, updateOidcSettings);
// Other providers next to Authentik, and which one is the active one.
router.post('/oidc/providers', requireAuth, roleManagerOnly, requireFreshLogin, addOidcProvider);
router
  .route('/oidc/providers/:id')
  .put(requireAuth, roleManagerOnly, requireFreshLogin, updateOidcProvider)
  .delete(requireAuth, roleManagerOnly, requireFreshLogin, deleteOidcProvider);
router.put('/oidc/active', requireAuth, roleManagerOnly, requireFreshLogin, setActiveOidcProvider);

export default router;
