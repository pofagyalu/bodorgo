// Read-only summary of the club's books (Pénzügyek) - for a talk or a
// check, nothing is written. usage:
//   node scripts/financeSummary.mjs [path/to/.env]   (default: ./.env)
// Prints per year the income and expense by category (HUF; EUR entries
// listed apart), the running balance and the membership fees paid.
import fs from 'fs';
import mongoose from 'mongoose';

const envFile = process.argv[2] ?? '.env';
const uri = fs
  .readFileSync(envFile, 'utf8')
  .split(/\r?\n/)
  .find((l) => l.startsWith('DB_URI='))
  ?.slice('DB_URI='.length)
  .trim();
if (!uri) throw new Error(`no DB_URI in ${envFile}`);

await mongoose.connect(uri);
const tx = mongoose.connection.db.collection('transactions');
const all = await tx
  .find(
    {},
    { projection: { date: 1, type: 1, category: 1, amount: 1, currency: 1, membershipYear: 1 } },
  )
  .toArray();

const fmt = (n) => Math.round(n).toLocaleString('hu-HU');
console.log(`database: ${mongoose.connection.name}  entries: ${all.length}`);
if (all.length) {
  const dates = all.map((t) => new Date(t.date)).sort((a, b) => a - b);
  console.log(
    `from ${dates[0].toISOString().slice(0, 10)} to ${dates.at(-1).toISOString().slice(0, 10)}`,
  );
}

const years = {};
for (const t of all) {
  const y = new Date(t.date).getFullYear();
  const cur = t.currency === 'EUR' ? 'EUR' : 'HUF';
  years[y] ??= { HUF: { income: {}, expense: {} }, EUR: { income: {}, expense: {} } };
  const bucket = years[y][cur][t.type] ?? (years[y][cur][t.type] = {});
  bucket[t.category] = (bucket[t.category] ?? 0) + t.amount;
}
let balance = 0;
for (const y of Object.keys(years).sort()) {
  const huf = years[y].HUF;
  const inc = Object.values(huf.income).reduce((a, b) => a + b, 0);
  const exp = Object.values(huf.expense).reduce((a, b) => a + b, 0);
  balance += inc - exp;
  console.log(
    `\n${y}: income ${fmt(inc)} Ft, expense ${fmt(exp)} Ft, result ${fmt(inc - exp)} Ft, running balance ${fmt(balance)} Ft`,
  );
  for (const [k, v] of Object.entries(huf.income).sort((a, b) => b[1] - a[1]))
    console.log(`   + ${k}: ${fmt(v)}`);
  for (const [k, v] of Object.entries(huf.expense).sort((a, b) => b[1] - a[1]))
    console.log(`   - ${k}: ${fmt(v)}`);
  const eur = years[y].EUR;
  for (const type of ['income', 'expense']) {
    for (const [k, v] of Object.entries(eur[type]))
      console.log(`   ${type === 'income' ? '+' : '-'} ${k}: ${fmt(v)} EUR`);
  }
}
const fees = all.filter((t) => t.membershipYear);
const byYear = {};
for (const t of fees) byYear[t.membershipYear] = (byYear[t.membershipYear] ?? 0) + 1;
console.log(`\nmembership fee entries by year: ${JSON.stringify(byYear)}`);
await mongoose.disconnect();
