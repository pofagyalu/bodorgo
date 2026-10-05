// Sets a user's record back to "never logged in", so the app offers an
// invitation for them again: takes off the Authentik id (sub), the last
// login's time, the e-mail-verified flag and the mark of an invitation
// sent. Nothing else of the record is touched - the role, the family, the
// posts and payments tied to it all stay. For a test account whose
// Authentik user was deleted. Run from server/:
//   node scripts/resetLogin.mjs someone@example.com                             (dry run, dev - .env)
//   node scripts/resetLogin.mjs someone@example.com --env=S:/bodorgo/.env        (dry run on live)
//   node scripts/resetLogin.mjs someone@example.com --env=S:/bodorgo/.env --go   (does it on live)
import fs from 'fs';
import mongoose from 'mongoose';

const email = process.argv[2]?.toLowerCase();
if (!email || email.startsWith('--')) throw new Error('Give the e-mail first.');
const go = process.argv.includes('--go');
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
const users = db.collection('users');
console.log(`database: ${db.databaseName}`);

const FIELDS = ['sub', 'lastLoginAt', 'emailVerified', 'invitation'];
const show = (user) =>
  FIELDS.map((f) => {
    const v = user[f];
    if (v === undefined) return `${f}: -`;
    if (f === 'sub') return `sub: set (${String(v).length} chars)`;
    if (f === 'invitation') return `invitation: ${JSON.stringify(Object.keys(v ?? {}))}`;
    return `${f}: ${v instanceof Date ? v.toISOString() : v}`;
  }).join('  |  ');

const matches = await users.find({ email }).toArray();
if (matches.length !== 1) {
  console.log(`expected one user with the e-mail ${email}, found ${matches.length} - nothing done`);
} else {
  const [user] = matches;
  console.log(`user: ${user.name} <${user.email}>  role: ${user.role}`);
  console.log(`now:   ${show(user)}`);
  if (!go) {
    console.log('dry run - nothing changed (add --go)');
  } else {
    const unset = Object.fromEntries(FIELDS.map((f) => [f, '']));
    const result = await users.updateOne({ _id: user._id }, { $unset: unset });
    const after = await users.findOne({ _id: user._id });
    console.log(`changed: ${result.modifiedCount}`);
    console.log(`after: ${show(after)}`);
    console.log(`kept:  role ${after.role}, family ${after.familyId ?? '-'}, name ${after.name}`);
  }
}
await mongoose.disconnect();
