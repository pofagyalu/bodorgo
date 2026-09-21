// Verifies userController.js's computeAge() and the birthday/gender
// plumbing through createUser/updateUser - age is derived, never stored,
// and birthday itself is only ever used to compute it (never rendered in
// the admin table - see profile.html).
//
// Creates and cleans up its own throwaway user - safe to re-run.
//
// Usage:
//   node scripts/testUserAge.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import User from '../src/models/userModel.js';
import { computeAge, createUser, updateUser } from '../src/controllers/userController.js';

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

await mongoose.connect(config.db.testUri);
await User.deleteMany({ name: { $regex: '^ZZ Age Test' } }); // clean slate

const today = new Date();
const exactlyTenYearsAgoToday = new Date(today.getFullYear() - 10, today.getMonth(), today.getDate());
const tenYearsAgoButBirthdayNotYetThisYear = new Date(
  today.getFullYear() - 10,
  today.getMonth() + 1, // a month from now - hasn't happened yet this year
  today.getDate(),
);

check('no birthday -> null, not 0 or NaN', computeAge(null) === null);
check('birthday is exactly N years ago today -> N', computeAge(exactlyTenYearsAgoToday) === 10);
check(
  "birthday hasn't occurred yet this year -> N-1, not N",
  computeAge(tenYearsAgoButBirthdayNotYetThisYear) === 9,
);

const createRes = fakeRes();
await createUser(
  {
    body: {
      name: 'ZZ Age Test Person',
      birthday: exactlyTenYearsAgoToday.toISOString(),
      gender: 'nő',
    },
  },
  createRes,
);
check('createUser saves birthday/gender and returns a computed age', createRes.body?.data?.user?.age === 10);
check('createUser response includes gender', createRes.body?.data?.user?.gender === 'nő');

const userId = createRes.body.data.user._id;

const updateRes = fakeRes();
await updateUser(
  { params: { id: userId }, body: { birthday: tenYearsAgoButBirthdayNotYetThisYear.toISOString() } },
  updateRes,
);
check("updateUser recomputes age from the new birthday", updateRes.body?.data?.user?.age === 9);

const unsetRes = fakeRes();
await updateUser({ params: { id: userId }, body: { birthday: '' } }, unsetRes);
check('an empty-string birthday clears it, age goes back to null', unsetRes.body?.data?.user?.age === null);

await User.deleteMany({ name: { $regex: '^ZZ Age Test' } });
console.log('\nCleaned up test user.');

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');

await mongoose.disconnect();
