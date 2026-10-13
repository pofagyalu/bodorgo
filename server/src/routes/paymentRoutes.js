import express from 'express';
import {
  startPayment,
  startMembershipPayment,
  recordCashMembershipPayment,
  recordCashPayment,
  deleteCashPayment,
  getPaymentStatus,
  downloadReceipt,
  barionCallback,
  getWithdrawalStatus,
  withdrawFunds,
  getStripePayouts,
  createStripePayoutNow,
} from '../controllers/paymentController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';
import { requireFreshLogin } from '../auth/freshLogin.js';

const router = express.Router();

// Note: the Stripe webhook (POST /payments/stripe/webhook) is NOT
// registered here - it needs the raw request body for signature
// verification, so it's mounted directly in app.js, before the app-wide
// express.json() middleware would otherwise parse it away. See app.js's
// own comment on that route.
router.post('/start', requireAuth, startPayment);
router.post('/membership/start', requireAuth, startMembershipPayment);
// No auth, no signature to verify (see barionCallback's own comment) -
// Barion calls this server-to-server, unlike the Stripe webhook it needs
// no special raw-body handling since there's no payload to verify.
router.get('/barion/callback', barionCallback);
// The ones below that move money: only for someone who identified themselves in
// the last minutes (auth/freshLogin.js).
router.post('/cash', requireAuth, restrictTo('admin'), requireFreshLogin, recordCashPayment);
// A member's yearly dues handed over in cash (Klub → Felhasználók).
router.post(
  '/cash-membership',
  requireAuth,
  restrictTo('admin'),
  requireFreshLogin,
  recordCashMembershipPayment,
);
router.get('/withdraw/:purpose', requireAuth, restrictTo('admin'), getWithdrawalStatus);
router.post('/withdraw', requireAuth, restrictTo('admin'), requireFreshLogin, withdrawFunds);
// Stripe: an account's balance, and paying it out to its bank account.
router.get('/stripe/payouts/:wallet', requireAuth, restrictTo('admin'), getStripePayouts);
router.post(
  '/stripe/payouts',
  requireAuth,
  restrictTo('admin'),
  requireFreshLogin,
  createStripePayoutNow,
);
router.delete('/:id', requireAuth, restrictTo('admin'), requireFreshLogin, deleteCashPayment);
router.get('/:id/status', requireAuth, getPaymentStatus);
router.get('/:id/receipt', requireAuth, downloadReceipt);

export default router;
