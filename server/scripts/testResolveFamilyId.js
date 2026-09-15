// Verifies userController.js's resolveFamilyId() - the admin table only
// ever shows the last 6 characters of a familyId, so the add/edit user
// form needs to accept that same short suffix, not just the full 24-char
// ObjectId. This was a real reported bug: pasting the visible "4df9e8"
// suffix into the form threw a Mongoose cast error before this existed.
// Creates and cleans up its own throwaway users - safe to re-run.
//
// Usage:
//   node scripts/testResolveFamilyId.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import User from '../src/models/userModel.js';
import { resolveFamilyId } from '../src/controllers/userController.js';

await mongoose.connect(config.db.testUri);
await User.deleteMany({ name: { $regex: '^ZZ Resolve Family Test' } }); // clean slate

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

const familyId = new mongoose.Types.ObjectId();
await User.create({ name: 'ZZ Resolve Family Test A', familyId });
await User.create({ name: 'ZZ Resolve Family Test B', familyId });

const fullId = familyId.toString();
const suffix = fullId.slice(-6);

const resolvedFromFull = await resolveFamilyId(fullId);
check('a full 24-char id resolves to itself', resolvedFromFull === fullId);

const resolvedFromSuffix = await resolveFamilyId(suffix);
check(
  'the 6-char suffix shown in the admin table resolves to the full id',
  resolvedFromSuffix === fullId,
);

let notFoundRejected = false;
try {
  await resolveFamilyId('ffffff');
} catch (err) {
  notFoundRejected = /Nem található/.test(err.message);
}
check('a suffix matching nothing is rejected clearly', notFoundRejected);

// A second, unrelated family whose id happens to end in the exact same 6
// characters must be flagged as ambiguous, not silently resolved to
// whichever one happens to be found first.
// A real ObjectId's first 18 chars encode a timestamp+random value that
// will never actually be all f's, so this is guaranteed to differ from
// fullId while still ending in the same suffix.
const collidingFamilyId = new mongoose.Types.ObjectId('f'.repeat(18) + suffix);
await User.create({ name: 'ZZ Resolve Family Test C', familyId: collidingFamilyId });
let ambiguousRejected = false;
try {
  await resolveFamilyId(suffix);
} catch (err) {
  ambiguousRejected = /Több család/.test(err.message);
}
check('a suffix matching two different families is rejected as ambiguous', ambiguousRejected);

await User.deleteMany({ name: { $regex: '^ZZ Resolve Family Test' } });
console.log('\nCleaned up test users.');

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');

await mongoose.disconnect();
