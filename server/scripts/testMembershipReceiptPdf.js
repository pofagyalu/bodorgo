// Smoke test for the membershipFee branch of generateReceiptPdf - doesn't
// touch the database, just verifies the PDF actually generates without
// throwing for a membership-shaped payment object.
//
// Usage:
//   node scripts/testMembershipReceiptPdf.js

import mongoose from 'mongoose';
import { generateReceiptPdf } from '../src/utils/paymentReceipt.js';

const fakePayment = {
  _id: new mongoose.Types.ObjectId(),
  purpose: 'membershipFee',
  createdAt: new Date(),
  amount: 2000,
  members: [
    { name: 'Nagy Zoltán', amount: 1000, membershipYear: 2026 },
    { name: 'Bíró Melinda', amount: 1000, membershipYear: 2026 },
  ],
};

const filename = await generateReceiptPdf(fakePayment, 'Nagy Zoltán', null, null);
console.log(`Generated: documents/payments/${filename}`);
