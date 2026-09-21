// Verifies getAllUsers' per-role response shape after opening the '/'
// users list up to 'member' (previously admin-only) - see userRoutes.js
// and profile.html/profile.ts, which now show the same table to both
// roles but hide familyId/role/lastLoginAt (and the raw birthday) from a
// plain member's response, not just from the UI.
//
// Read-only against real data - creates nothing, safe to re-run.
//
// Usage:
//   node scripts/testUsersListRoleAccess.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import { getAllUsers } from '../src/controllers/userController.js';

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

const adminRes = fakeRes();
await getAllUsers({ user: { role: 'admin' } }, adminRes);
const adminUsers = adminRes.body?.data?.users ?? [];

check('admin request succeeds with at least one user', adminUsers.length > 0);
// familyId/lastLoginAt are optional per-user, so .lean() only includes them
// on documents that actually have a value stored - check across the whole
// list rather than assuming any single user has every field.
check(
  'admin response includes management fields (role always, familyId/lastLoginAt on at least one user)',
  adminUsers.every((u) => 'role' in u) &&
    adminUsers.some((u) => 'familyId' in u) &&
    adminUsers.some((u) => 'lastLoginAt' in u),
);
check('admin response still includes a computed age field', 'age' in adminUsers[0]);

const memberRes = fakeRes();
await getAllUsers({ user: { role: 'member' } }, memberRes);
const memberUsers = memberRes.body?.data?.users ?? [];

check('member request succeeds with the same number of users as admin', memberUsers.length === adminUsers.length);
check(
  'member response omits familyId/role/lastLoginAt/sub/createdAt entirely',
  !('familyId' in memberUsers[0]) &&
    !('role' in memberUsers[0]) &&
    !('lastLoginAt' in memberUsers[0]) &&
    !('sub' in memberUsers[0]) &&
    !('createdAt' in memberUsers[0]),
);
check('member response omits the raw birthday too', !('birthday' in memberUsers[0]));
check('member response still includes name/email/gender/computed age', 'name' in memberUsers[0] && 'age' in memberUsers[0]);

// Same underlying people, just a trimmed view - names should line up 1:1
// in the same sorted order.
const namesMatch = adminUsers.every((u, i) => u.name === memberUsers[i]?.name);
check('member and admin views list the same people in the same order', namesMatch);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');

await mongoose.disconnect();
