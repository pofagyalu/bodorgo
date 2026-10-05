// Shows how a user stands in the app's database by e-mail: the role, and
// whether the record is tied to an Authentik identity already (its sub,
// shortened). Reads only. Run from server/:
//   node scripts/userByEmail.mjs someone@example.com                        (dev - .env)
//   node scripts/userByEmail.mjs someone@example.com --env=S:/bodorgo/.env  (live)
import fs from 'fs';
import mongoose from 'mongoose';

const email = process.argv[2]?.toLowerCase();
if (!email || email.startsWith('--')) throw new Error('Give the e-mail first.');
const envFile = process.argv.find((a) => a.startsWith('--env='))?.slice('--env='.length) ?? '.env';
const line = fs
  .readFileSync(envFile, 'utf8')
  .split(/\r?\n/)
  .find((l) => l.startsWith('DB_URI='));
if (!line) throw new Error(`No DB_URI in ${envFile}`);

await mongoose.connect(
  line
    .slice('DB_URI='.length)
    .trim()
    .replace(/^["']|["']$/g, ''),
);
const db = mongoose.connection.db;
console.log(`database: ${db.databaseName}`);
const users = await db
  .collection('users')
  .find(
    { email },
    { projection: { name: 1, email: 1, role: 1, sub: 1, createdAt: 1, updatedAt: 1 } },
  )
  .toArray();
if (!users.length) console.log(`no user with the e-mail ${email}`);
for (const user of users) {
  const sub = user.sub
    ? `${String(user.sub).slice(0, 10)}… (${String(user.sub).length} chars)`
    : 'NONE';
  console.log(
    `${user.name} <${user.email}>  role: ${user.role}  sub: ${sub}  created: ${user.createdAt?.toISOString() ?? '?'}  updated: ${user.updatedAt?.toISOString() ?? '?'}`,
  );
}
await mongoose.disconnect();
