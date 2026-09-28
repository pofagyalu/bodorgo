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
} from '../controllers/paymentController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';

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
router.post('/cash', requireAuth, restrictTo('admin'), recordCashPayment);
// A member's yearly dues handed over in cash (Klub → Felhasználók).
router.post('/cash-membership', requireAuth, restrictTo('admin'), recordCashMembershipPayment);
router.get('/withdraw/:purpose', requireAuth, restrictTo('admin'), getWithdrawalStatus);
router.post('/withdraw', requireAuth, restrictTo('admin'), withdrawFunds);
router.delete('/:id', requireAuth, restrictTo('admin'), deleteCashPayment);
router.get('/:id/status', requireAuth, getPaymentStatus);
router.get('/:id/receipt', requireAuth, downloadReceipt);

export default router;
