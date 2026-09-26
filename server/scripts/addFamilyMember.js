// Temporary CLI utility for adding a login-less dependent (typically a
// child with no email of their own) to an existing family - see
// userModel.js's familyId field and createFamily.js, which creates the
// family in the first place from an existing real account.
//
// If the child already has (or will soon have) their own email, pass it as
// futureEmail: the account stays login-less until they actually log in
// through Authentik with that exact email, at which point
// authOidcController.js claims this same record (and its attendance
// history) instead of creating a disconnected new one.
//
// Usage:
//   node scripts/addFamilyMember.js <anchor> <name> [futureEmail]
//
// <anchor> identifies any existing member of the family - their email, or
// (if they have none) their exact name.

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import User from '../src/models/userModel.js';

const [, , anchor, name, futureEmail] = process.argv;

if (!anchor || !name) {
  console.error('Usage: node scripts/addFamilyMember.js <anchor> <name> [futureEmail]');
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
  console.error(`${anchorUser.name} doesn't belong to a family yet - run createFamily.js first.`);
  await mongoose.disconnect();
  process.exit(1);
}

const child = await User.create({
  name,
  familyId: anchorUser.familyId,
  email: futureEmail ? futureEmail.toLowerCase() : undefined,
  role: 'guest',
});

console.log(
  `Added "${child.name}" to ${anchorUser.name}'s family (${anchorUser.familyId})${
    futureEmail ? ` with future email ${child.email}` : ' (no email - login-less)'
  }.`,
);

await mongoose.disconnect();
