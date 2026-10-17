// Records a member's PAST years' dues as paid in cash on LIVE - exactly what
// Klub → Felhasználók's cash button does for the current year (server
// paymentController.js's recordCashMembershipPayment): a cash Payment, a
// Tagdíj income Transaction (the Kassza, dated now) and a Napló entry per
// year, entered in the role manager's name. The app has no button for a
// past year yet.
//
// Dry run (prints what it would do):
//   node scripts/recordPastCashDues.mjs <userId> 2024 2025
// For real: add --apply
import fs from 'fs';
import mongoose from 'mongoose';
import Payment from '../src/models/paymentModel.js';
import Transaction from '../src/models/transactionModel.js';
import AuditLog from '../src/models/auditLogModel.js';

const env = Object.fromEntries(
  fs
    .readFileSync('S:/bodorgo/.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
);

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const [userId, ...years] = args.filter((a) => a !== '--apply');
const yearList = years.map(Number);

await mongoose.connect(env.DB_URI);
const db = mongoose.connection.db;

const member = await db.collection('users').findOne({ _id: new mongoose.Types.ObjectId(userId) });
const owner = await db.collection('users').findOne({ canManageRoles: true });
const settings = await db.collection('clubsettings').findOne({ key: 'club' });
const feeFor = (year) =>
  [...(settings.membershipFees ?? [])]
    .sort((a, b) => b.fromYear - a.fromYear)
    .find((f) => f.fromYear <= year)?.amount;

console.log(
  `${apply ? 'APPLY' : 'DRY RUN'} - member ${member?.name} (since ${member?.memberSince}), entered by ${owner?.name}`,
);
if (!member || !owner) throw new Error('member or role manager not found');

for (const year of yearList) {
  const amount = feeFor(year);
  const thisYear = new Date().getFullYear();
  if (!amount || year < (member.memberSince ?? 2019) || year >= thisYear) {
    console.log(`  ${year}: skipped (no fee, before membership, or not a past year)`);
    continue;
  }
  const paid = await db.collection('payments').findOne({
    purpose: 'membershipFee',
    status: 'Succeeded',
    members: { $elemMatch: { user: member._id, membershipYear: year } },
  });
  if (paid) {
    console.log(`  ${year}: already paid - skipped`);
    continue;
  }
  const forint = String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const summary = `Készpénzes tagdíj: ${member.name}, ${year}. év - ${forint} Ft`;
  console.log(`  ${year}: ${amount} Ft cash payment + Kassza income + Napló "${summary}"`);
  if (!apply) continue;

  const payment = await Payment.create({
    purpose: 'membershipFee',
    method: 'cash',
    createdBy: owner._id,
    members: [{ user: member._id, name: member.name, amount, membershipYear: year }],
    amount,
    status: 'Succeeded',
  });
  await Transaction.create({
    date: new Date(),
    name: `${member.name} tagdíja (${year}) – készpénz`,
    type: 'income',
    category: 'Tagdíj',
    amount,
    currency: payment.currency,
    createdBy: owner._id,
    user: member._id,
    membershipYear: year,
    payment: payment._id,
    paymentMethod: 'cash',
  });
  await AuditLog.create({
    action: 'cash-membership',
    actor: owner._id,
    actorName: owner.name,
    target: member._id,
    targetName: member.name,
    summary,
    details: { paymentId: payment._id, year, amount },
  });
  console.log(`  ${year}: done (payment ${payment._id})`);
}
await mongoose.disconnect();
