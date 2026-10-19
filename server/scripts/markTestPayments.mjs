// Marks the online payments made before paymentModel.js's testMode existed
// that moved no real money: Stripe's test sessions (cs_test_...) and every
// Barion one (the app has only ever used Barion's sandbox - BARION_ENV was
// never production). Profilom → Befizetéseim then leaves them out.
// Usage: node scripts/markTestPayments.mjs [S:/bodorgo/.env] [--write]
// Without --write it only lists what it would mark.
import fs from 'fs';
import mongoose from 'mongoose';
const envFile = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'S:/bodorgo/.env';
const write = process.argv.includes('--write');
const env = Object.fromEntries(
  fs
    .readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
);
if (env.BARION_ENV === 'production') {
  throw new Error('BARION_ENV is production here: Barion payments may be real - not marking them.');
}
await mongoose.connect(env.DB_URI);
const payments = mongoose.connection.db.collection('payments');
const filter = {
  testMode: { $ne: true },
  $or: [{ method: 'stripe', providerPaymentId: /^cs_test_/ }, { method: 'barion' }],
};
for (const p of await payments.find(filter).sort({ createdAt: 1 }).toArray()) {
  console.log(
    p._id.toString(),
    p.createdAt?.toISOString(),
    p.method,
    p.status,
    p.amount,
    p.providerPaymentId,
  );
}
if (write) {
  const { modifiedCount } = await payments.updateMany(filter, { $set: { testMode: true } });
  console.log(`marked ${modifiedCount} as test payments`);
} else {
  console.log('(nothing written - add --write)');
}
await mongoose.disconnect();
