// One-off backfill: for every real club member (role admin/member), records
// a 1000 Ft "Tagdíj" income transaction for each year from their own
// memberSince (or the club's 2019 founding year, if that isn't set yet)
// through last year - i.e. every year that's already fully over, not the
// current one still in progress. Dated at a random point within that
// year, same as how the real historical dues were actually collected (in
// person, at some point during the year, not through a single scheduled
// online payment). Recorded as an admin's manual entry - method itself
// isn't tracked on Transaction (unlike Payment), just who entered it.
//
// These are real Transaction documents, so they immediately count toward
// the Klub Pénzügyek/Áttekintés pages' balance, and - via the user/
// membershipYear fields - toward each member's per-year paid status on
// the Felhasználók page (see members.ts/overview.ts's yearState/isPaid).
//
// Safe to re-run: skips any (member, year) pair that already has a Tagdíj
// transaction, so an interrupted or repeated run never double-charges.
//
// Usage:
//   node scripts/backfillMembershipDues.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import User from '../src/models/userModel.js';
import Transaction from '../src/models/transactionModel.js';

const CLUB_FOUNDING_YEAR = 2019;
const DUES_AMOUNT = 1000;

function randomDateIn(year) {
  const month = Math.floor(Math.random() * 12);
  // 1-28 for every month, regardless of length or leap years - the exact
  // day doesn't matter for a backfilled historical record, only that it
  // falls somewhere real within the year.
  const day = 1 + Math.floor(Math.random() * 28);
  return new Date(year, month, day);
}

await mongoose.connect(config.db.uri);

const admin = await User.findOne({ role: 'admin' }).sort('createdAt');
if (!admin) {
  console.error('No admin user found - cannot set createdBy.');
  await mongoose.disconnect();
  process.exit(1);
}

const members = await User.find({ role: { $in: ['admin', 'member'] } }).select('name memberSince');

const currentYear = new Date().getFullYear();
const lastYear = currentYear - 1;

let created = 0;
let skipped = 0;

for (const member of members) {
  const startYear = member.memberSince ?? CLUB_FOUNDING_YEAR;
  for (let year = startYear; year <= lastYear; year++) {
    const existing = await Transaction.findOne({
      user: member._id,
      membershipYear: year,
      category: 'Tagdíj',
      type: 'income',
    });
    if (existing) {
      skipped++;
      continue;
    }

    await Transaction.create({
      date: randomDateIn(year),
      name: `${member.name} tagdíja (${year})`,
      type: 'income',
      category: 'Tagdíj',
      amount: DUES_AMOUNT,
      currency: 'HUF',
      createdBy: admin._id,
      user: member._id,
      membershipYear: year,
    });
    created++;
  }
}

console.log(`Created ${created} Tagdíj transaction(s), skipped ${skipped} already recorded.`);

await mongoose.disconnect();
