// Read-only: a member's record and membership-fee payments on live.
// Usage: node scripts/showMemberFees.mjs "Nagy Mari"
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
const name = process.argv[2];
const users = await db
  .collection('users')
  .find(
    { name: { $regex: name, $options: 'i' } },
    { projection: { name: 1, role: 1, memberSince: 1, email: 1, familyId: 1 } },
  )
  .toArray();
for (const u of users) {
  console.log(
    u._id.toString(),
    u.name,
    'role',
    u.role,
    'memberSince',
    u.memberSince,
    'email',
    u.email ? 'yes' : 'no',
  );
  const pays = await db
    .collection('payments')
    .find(
      { 'members.user': u._id },
      { projection: { status: 1, method: 1, purpose: 1, 'members.$': 1, createdAt: 1 } },
    )
    .toArray();
  for (const p of pays)
    console.log(
      '   payment',
      p.purpose,
      p.method,
      p.status,
      p.members[0]?.membershipYear,
      p.members[0]?.amount,
      p.createdAt?.toISOString?.().slice(0, 10),
    );
}
const settings = await db
  .collection('clubsettings')
  .findOne({ key: 'club' }, { projection: { membershipFees: 1 } });
console.log('fees', JSON.stringify(settings?.membershipFees));
await mongoose.disconnect();
