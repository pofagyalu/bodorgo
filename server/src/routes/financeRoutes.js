import express from 'express';
import { getTransactions, createTransaction } from '../controllers/financeController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';

const router = express.Router();

router.get('/transactions', requireAuth, restrictTo('admin', 'member'), getTransactions);
router.post('/transactions', requireAuth, restrictTo('admin'), createTransaction);

export default router;
