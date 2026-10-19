// Read-only: someone's own online payments on live, as Profilom →
// Befizetéseim lists them - with the provider id and receipt file, and
// whether that file is on disk.
// Usage: node scripts/showMyPayments.mjs pofagyalu@gmail.com
import fs from 'fs';
import path from 'path';
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
const user = await db.collection('users').findOne({ email: process.argv[2] });
if (!user) throw new Error('no such user');
console.log(user._id.toString(), user.name);
console.log('stripe key mode:', (env.STRIPE_SECRET_KEY ?? '').slice(0, 8));
const payments = await db
  .collection('payments')
  .find({ createdBy: user._id, status: 'Succeeded', method: { $in: ['stripe', 'barion'] } })
  .sort({ createdAt: -1 })
  .toArray();
for (const p of payments) {
  const file = p.receiptFilename;
  const onDisk = file
    ? ['S:/bodorgo/receipts', 'S:/bodorgo/documents/receipts'].some((d) =>
        fs.existsSync(path.join(d, file)),
      )
    : null;
  console.log(
    p._id.toString(),
    p.createdAt?.toISOString(),
    p.purpose,
    p.method,
    p.amount,
    p.providerPaymentId,
    file,
    'onDisk:',
    onDisk,
  );
}
await mongoose.disconnect();
