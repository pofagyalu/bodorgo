// Read-only: why the Tagdíj emlékeztető would (not) go to each unpaid member
// on live this year.
import fs from 'fs';
import mongoose from 'mongoose';
const env = Object.fromEntries(
  fs
    .readFileSync('S:/bodorgo/.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
);
await mongoose.connect(env.DB_URI);
const db = mongoose.connection.db;
const year = new Date().getFullYear();
const members = await db
  .collection('users')
  .find({
    role: { $in: ['admin', 'member'] },
    retired: { $ne: true },
    $or: [{ memberSince: null }, { memberSince: { $lte: year } }],
  })
  .toArray();
const paid = new Set(
  (
    await db
      .collection('transactions')
      .distinct('user', { type: 'income', category: 'Tagdíj', membershipYear: year })
  ).map(String),
);
const unpaid = members.filter((m) => !paid.has(String(m._id)));
const count = (f) => unpaid.filter(f).length;
console.log(
  `${year}: ${members.length} club members, ${members.length - unpaid.length} paid, ${unpaid.length} unpaid`,
);
console.log(`  unpaid with e-mail: ${count((m) => m.email)}`);
console.log(`  unpaid who have logged in: ${count((m) => m.lastLoginAt)}`);
console.log(
  `  unpaid, logged in, with e-mail (would get it): ${count((m) => m.lastLoginAt && m.email)}`,
);
await mongoose.disconnect();
