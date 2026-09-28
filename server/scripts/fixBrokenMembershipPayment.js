// One-off repair: Payment 6ab3b555a06b5be50d3f30c8 (a real membershipFee
// payment for Nagy Zoltán + Bíró Melinda, 2026) was marked Succeeded by
// Stripe's webhook before paymentController.js knew about the
// membershipFee purpose (production hadn't been deployed with it yet -
// the webhook can only ever reach production, never a local dev server).
// It ran the old tourAdvance-only path instead (hence the wrong email/PDF
// the payer got), so the Transaction entries that should have been
// created for it never were. This creates them now, exactly as
// markMembershipPaid would have.
//
// Usage:
//   node scripts/fixBrokenMembershipPayment.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Payment from '../src/models/paymentModel.js';
import Transaction from '../src/models/transactionModel.js';

const PAYMENT_ID = '6ab3b555a06b5be50d3f30c8';

await mongoose.connect(config.db.uri);

const payment = await Payment.findById(PAYMENT_ID);
if (!payment) {
  console.error(`No payment found with id ${PAYMENT_ID}`);
  await mongoose.disconnect();
  process.exit(1);
}
if (payment.purpose !== 'membershipFee' || payment.status !== 'Succeeded') {
  console.error('Payment is not a Succeeded membershipFee payment - aborting.');
  await mongoose.disconnect();
  process.exit(1);
}

for (const m of payment.members) {
  const existing = await Transaction.findOne({
    user: m.user,
    membershipYear: m.membershipYear,
    category: 'Tagdíj',
    type: 'income',
  });
  if (existing) {
    console.log(`Skipped ${m.name} (${m.membershipYear}) - already exists.`);
    continue;
  }

  await Transaction.create({
    date: payment.updatedAt,
    name: `${m.name} tagdíja (${m.membershipYear})`,
    type: 'income',
    category: 'Tagdíj',
    amount: m.amount,
    currency: payment.currency,
    createdBy: payment.createdBy,
    user: m.user,
    membershipYear: m.membershipYear,
  });
  console.log(`Created transaction for ${m.name} (${m.membershipYear}).`);
}

await mongoose.disconnect();
