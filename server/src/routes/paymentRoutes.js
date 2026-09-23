import express from 'express';
import { startPayment, recordCashPayment, deleteCashPayment, getPaymentStatus, downloadReceipt } from '../controllers/paymentController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';

const router = express.Router();

// Note: the Stripe webhook (POST /payments/stripe/webhook) is NOT
// registered here - it needs the raw request body for signature
// verification, so it's mounted directly in app.js, before the app-wide
// express.json() middleware would otherwise parse it away. See app.js's
// own comment on that route.
router.post('/start', requireAuth, startPayment);
router.post('/cash', requireAuth, restrictTo('admin'), recordCashPayment);
router.delete('/:id', requireAuth, restrictTo('admin'), deleteCashPayment);
router.get('/:id/status', requireAuth, getPaymentStatus);
router.get('/:id/receipt', requireAuth, downloadReceipt);

export default router;
