// Removes one person's membership payment for one year - its Tagdíj income
// entry and the Payment records behind it - so the year shows unpaid again
// (e.g. to try paying it once more). Dry run by default; --go deletes.
//   node scripts/removeMembershipPayment.mjs <email> <year> [--go]
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/models/userModel.js';
import Transaction from '../src/models/transactionModel.js';
import Payment from '../src/models/paymentModel.js';

const [email, yearArg] = process.argv.slice(2);
const go = process.argv.includes('--go');
const year = Number(yearArg);
if (!email || !Number.isInteger(year)) {
  console.error('Usage: node scripts/removeMembershipPayment.mjs <email> <year> [--go]');
  process.exit(1);
}

await mongoose.connect(process.env.DB_URI);
console.log(`Database: ${mongoose.connection.name}`);

const user = await User.findOne({ email: email.toLowerCase() }).select('name email');
if (!user) {
  console.error(`No user with e-mail ${email}`);
  process.exit(1);
}

const transactions = await Transaction.find({
  type: 'income',
  category: 'Tagdíj',
  user: user._id,
  membershipYear: year,
});
const payments = await Payment.find({
  purpose: 'membershipFee',
  'members.user': user._id,
  'members.membershipYear': year,
});

console.log(`${user.name} <${user.email}>, ${year}:`);
for (const t of transactions) {
  console.log(`  Transaction ${t._id}: "${t.name}", ${t.amount} Ft, ${t.paymentMethod ?? '-'}`);
}
for (const p of payments) {
  const others = p.members.filter((m) => String(m.user) !== String(user._id) || m.membershipYear !== year);
  console.log(
    `  Payment ${p._id}: ${p.method}, ${p.status}, ${p.amount} Ft, ${p.createdAt.toISOString()}` +
      (others.length ? ` - ALSO covers ${others.map((m) => `${m.name} ${m.membershipYear}`).join(', ')} (kept)` : ''),
  );
}

// A payment that also covers someone else / another year stays.
const removable = payments.filter((p) =>
  p.members.every((m) => String(m.user) === String(user._id) && m.membershipYear === year),
);

if (!go) {
  console.log(`\nDry run: would delete ${transactions.length} transaction(s), ${removable.length} payment(s). Add --go to delete.`);
} else {
  await Transaction.deleteMany({ _id: { $in: transactions.map((t) => t._id) } });
  await Payment.deleteMany({ _id: { $in: removable.map((p) => p._id) } });
  console.log(`\nDeleted ${transactions.length} transaction(s), ${removable.length} payment(s).`);
}

await mongoose.disconnect();
