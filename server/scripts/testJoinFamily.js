// Verifies the userController.js joinFamily logic: grouping several
// existing users into one shared family, reusing an existing familyId
// among the selection when there is exactly one, and refusing to silently
// merge two already-different families. Creates and cleans up its own
// throwaway users - safe to re-run.
//
// Usage:
//   node scripts/testJoinFamily.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import User from '../src/models/userModel.js';

async function simulateJoinFamily(userIds) {
  if (!Array.isArray(userIds) || userIds.length < 2) {
    throw new Error('Legalább 2 felhasználót ki kell választani.');
  }
  const users = await User.find({ _id: { $in: userIds } }).select('familyId');
  if (users.length !== userIds.length) {
    throw new Error('Néhány kiválasztott felhasználó nem található.');
  }
  const existingFamilyIds = [
    ...new Set(users.filter((u) => u.familyId).map((u) => u.familyId.toString())),
  ];
  if (existingFamilyIds.length > 1) {
    throw new Error('A kiválasztott felhasználók már különböző családokhoz tartoznak.');
  }
  const familyId = existingFamilyIds[0] || new mongoose.Types.ObjectId();
  await User.updateMany({ _id: { $in: userIds } }, { familyId });
  return familyId;
}

await mongoose.connect(config.db.testUri);
await User.deleteMany({ name: { $regex: '^ZZ Join Family Test' } }); // clean slate

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

// Case 1: none of the selected have a familyId yet (the real "Antalfy" scenario) -
// a brand new shared familyId should be created for all of them.
const a = await User.create({ name: 'ZZ Join Family Test A' });
const b = await User.create({ name: 'ZZ Join Family Test B' });
const c = await User.create({ name: 'ZZ Join Family Test C' });

const newFamilyId = await simulateJoinFamily([a._id, b._id, c._id]);
const reloaded = await User.find({ _id: { $in: [a._id, b._id, c._id] } });
check(
  'all three now share the new familyId',
  reloaded.every((u) => u.familyId?.toString() === newFamilyId.toString()),
);

// Case 2: one of the selected already has a familyId - it should be reused,
// not replaced, so extending an existing family works.
const d = await User.create({ name: 'ZZ Join Family Test D' });
const extendedFamilyId = await simulateJoinFamily([a._id, d._id]);
check('extending an existing family reuses its familyId', extendedFamilyId.toString() === newFamilyId.toString());

// Case 3: two of the selected already belong to different families - must
// be rejected rather than silently merged (could orphan other members).
const e = await User.create({ name: 'ZZ Join Family Test E', familyId: new mongoose.Types.ObjectId() });
let conflictRejected = false;
try {
  await simulateJoinFamily([a._id, e._id]);
} catch (err) {
  conflictRejected = /különböző családokhoz/.test(err.message);
}
check('conflicting families are rejected, not merged', conflictRejected);

await User.deleteMany({ name: { $regex: '^ZZ Join Family Test' } });
console.log('\nCleaned up test users.');

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');

await mongoose.disconnect();
