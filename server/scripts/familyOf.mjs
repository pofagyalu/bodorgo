// Who shares a family with a user (by e-mail) - names and roles only.
// Reads only. Run from server/:
//   node scripts/familyOf.mjs someone@example.com [--env=S:/bodorgo/.env]
import fs from 'fs';
import mongoose from 'mongoose';

const email = process.argv[2]?.toLowerCase();
const envFile = process.argv.find((a) => a.startsWith('--env='))?.slice('--env='.length) ?? '.env';
const line = fs
  .readFileSync(envFile, 'utf8')
  .split(/\r?\n/)
  .find((l) => l.startsWith('DB_URI='));
await mongoose.connect(line.slice('DB_URI='.length).trim().replace(/^["']|["']$/g, ''));
const users = mongoose.connection.db.collection('users');
const user = await users.findOne({ email });
if (!user?.familyId) console.log('no family');
else {
  const family = await users.find({ familyId: user.familyId }).toArray();
  for (const m of family) console.log(`${m.name}  role: ${m.role}  has login: ${!!m.sub}  ${m.email === email ? '<- this user' : ''}`);
}
await mongoose.disconnect();
