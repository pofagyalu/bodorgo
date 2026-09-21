// Verifies the 3-rule eligibility filter for the admin's "email the
// Programfüzet to every attendee" bulk send: has an email address, has
// logged in at least once (lastLoginAt set), and hasn't turned off
// wantsEmailNotifications. Pure function, no DB/network involved.
//
// Usage:
//   node scripts/testAttendeeEmailEligibility.js

import { partitionAttendeesByEmailEligibility } from '../src/controllers/tourPdfController.js';

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

const eligibleUser = { name: 'Eligible Elemér', email: 'elemer@example.com', lastLoginAt: new Date(), wantsEmailNotifications: true };
const noEmailUser = { name: 'No Email Nóra', email: undefined, lastLoginAt: new Date(), wantsEmailNotifications: true };
const neverLoggedInUser = { name: 'Csecsemő Csenge', email: 'csenge@example.com', lastLoginAt: undefined, wantsEmailNotifications: true };
const optedOutUser = { name: 'Opt-out Ottó', email: 'otto@example.com', lastLoginAt: new Date(), wantsEmailNotifications: false };
// Older documents may genuinely have this field undefined (schema default
// only fills it in on hydration, not for a .lean() read) - undefined must
// NOT be treated the same as an explicit false.
const legacyUserNoFieldAtAll = { name: 'Régi Réka', email: 'reka@example.com', lastLoginAt: new Date(), wantsEmailNotifications: undefined };

const { eligible, skipped } = partitionAttendeesByEmailEligibility([
  eligibleUser,
  noEmailUser,
  neverLoggedInUser,
  optedOutUser,
  legacyUserNoFieldAtAll,
]);

check('eligible list has exactly 2 people', eligible.length === 2);
check('the clearly-eligible user is in the eligible list', eligible.some((u) => u.name === 'Eligible Elemér'));
check(
  'a legacy user with no wantsEmailNotifications field at all defaults to eligible (not skipped)',
  eligible.some((u) => u.name === 'Régi Réka'),
);
check('skipped list has exactly 3 people', skipped.length === 3);
check(
  'the no-email user is skipped with the right reason',
  skipped.some((s) => s.name === 'No Email Nóra' && s.reason === 'nincs e-mail cím'),
);
check(
  'the never-logged-in user is skipped with the right reason',
  skipped.some((s) => s.name === 'Csecsemő Csenge' && s.reason === 'még sosem jelentkezett be'),
);
check(
  'the opted-out user is skipped with the right reason',
  skipped.some((s) => s.name === 'Opt-out Ottó' && s.reason === 'kikapcsolta az e-mail értesítéseket'),
);

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');
