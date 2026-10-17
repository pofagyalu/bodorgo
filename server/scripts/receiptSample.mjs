// Draws a sample payment receipt (a made-up dues payment by Stripe) to look
// at its layout - nothing is saved in the database:
//   node scripts/receiptSample.mjs <out.pdf>
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { generateReceiptPdf, RECEIPTS_DIR } from '../src/utils/paymentReceipt.js';

const out = process.argv[2] ?? 'receipt-sample.pdf';
await mongoose.connect(process.env.DB_URI);
const payment = {
  _id: new mongoose.Types.ObjectId(),
  purpose: 'membershipFee',
  method: 'stripe',
  amount: 2204,
  createdAt: new Date(),
  members: [
    { name: 'Minta Béla', amount: 1000, membershipYear: 2026 },
    { name: 'Minta Béláné', amount: 1000, membershipYear: 2026 },
  ],
  attendees: [],
};
const filename = await generateReceiptPdf(payment, 'Minta Béla', null, null);
fs.copyFileSync(path.join(RECEIPTS_DIR, filename), out);
fs.unlinkSync(path.join(RECEIPTS_DIR, filename));
console.log(out);
await mongoose.disconnect();
