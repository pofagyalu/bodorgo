// Temporary CLI utility to sanity-check a family's members while curating
// them by hand - see createFamily.js / addFamilyMember.js.
//
// Usage:
//   node scripts/listFamily.js <anchor>
//
// <anchor> identifies any existing member of the family - their email, or
// (if they have none) their exact name.

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import User from '../src/models/userModel.js';

const [, , anchor] = process.argv;

if (!anchor) {
  console.error('Usage: node scripts/listFamily.js <anchor>');
  process.exit(1);
}

await mongoose.connect(config.db.testUri);

const anchorUser = anchor.includes('@')
  ? await User.findOne({ email: anchor.toLowerCase() })
  : await User.findOne({ name: anchor });

if (!anchorUser) {
  console.error(`No user found matching "${anchor}"`);
  await mongoose.disconnect();
  process.exit(1);
}

if (!anchorUser.familyId) {
  console.error(`${anchorUser.name} doesn't belong to a family yet.`);
  await mongoose.disconnect();
  process.exit(1);
}

const members = await User.find({ familyId: anchorUser.familyId }).sort('name');

console.log(`Family ${anchorUser.familyId} (${members.length} member(s)):`);
for (const m of members) {
  const loginStatus = m.sub
    ? m.email
    : m.email
      ? `${m.email} (nem jelentkezett még be)`
      : 'nincs e-mail, nem tud bejelentkezni';
  console.log(`  - ${m.name} — ${loginStatus}`);
}

await mongoose.disconnect();
