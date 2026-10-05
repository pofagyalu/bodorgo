// Before a user is taken out of the database: where else their id stands.
// Goes through every collection and counts the documents that carry the
// user's id anywhere in them (reservations, payments, posts, votes…), so
// nothing is left pointing at nobody. Reads only. Run from server/:
//   node scripts/userReferences.mjs someone@example.com                        (dev - .env)
//   node scripts/userReferences.mjs someone@example.com --env=S:/bodorgo/.env  (live)
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

const user = await db.collection('users').findOne({ email });
if (!user) {
  console.log(`no user with the e-mail ${email}`);
} else {
  const id = String(user._id);
  console.log(
    `user: ${user.name} <${user.email}>  role: ${user.role}  id: ${id}  familyId: ${user.familyId ?? '-'}`,
  );
  // The fields of the user's own record that say something of what hangs
  // on it - not their values.
  console.log(`own record's fields: ${Object.keys(user).join(', ')}`);

  let found = 0;
  for (const { name } of await db.listCollections().toArray()) {
    if (name === 'users') continue;
    let count = 0;
    const fields = new Set();
    for await (const doc of db.collection(name).find({})) {
      const text = JSON.stringify(doc);
      if (!text.includes(id)) continue;
      count += 1;
      for (const [key, value] of Object.entries(doc)) {
        if (JSON.stringify(value)?.includes(id)) fields.add(key);
      }
    }
    if (count) {
      found += count;
      console.log(`${name}: ${count} document(s), in: ${[...fields].join(', ')}`);
    }
  }
  // Other users of the same family, or pointing at this one.
  const others = await db
    .collection('users')
    .find({ _id: { $ne: user._id } })
    .toArray();
  const pointing = others.filter((o) => JSON.stringify(o).includes(id));
  if (pointing.length) {
    found += pointing.length;
    console.log(
      `users: ${pointing.length} other user(s) carry this id: ${pointing.map((o) => o.name).join(', ')}`,
    );
  }
  if (!found) console.log('nothing else carries this user’s id');
}
await mongoose.disconnect();
