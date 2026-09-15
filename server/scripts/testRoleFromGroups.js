// Sanity check for authOidcController.js's roleFromGroups() - the pure
// function mapping Authentik group membership to a local role. Kept as a
// permanent script (not deleted after use) so the mapping's exact
// precedence (admin > bodorgo > guest, the "not in any group" fallback, and
// the "groups data missing entirely" null case) stays verifiable without
// needing a live Authentik login.
//
// Usage:
//   node scripts/testRoleFromGroups.js

import { roleFromGroups } from '../src/controllers/authOidcController.js';

const cases = [
  { groups: ['bodorgo-admin'], expected: 'admin' },
  { groups: ['bodorgo'], expected: 'bodorgo' },
  { groups: ['bodorgo-guest'], expected: 'guest' },
  { groups: ['bodorgo-admin', 'bodorgo'], expected: 'admin' }, // admin wins if in both
  { groups: ['bodorgo', 'bodorgo-guest'], expected: 'bodorgo' }, // bodorgo beats guest
  { groups: ['some-unrelated-group'], expected: 'guest' }, // real data, no matching group -> guest
  { groups: [], expected: 'guest' }, // real data, empty -> guest
  // Authentik didn't send groups data at all (misconfigured scope/mapping) -
  // null signals "unknown", NOT "guest", so the caller keeps the existing role.
  { groups: undefined, expected: null },
  { groups: null, expected: null },
];

let failures = 0;
for (const { groups, expected } of cases) {
  const actual = roleFromGroups(groups);
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} roleFromGroups(${JSON.stringify(groups)}) = ${actual} (expected ${expected})`);
}

if (failures > 0) {
  console.error(`\n${failures} case(s) failed.`);
  process.exit(1);
}
console.log('\nAll cases passed.');
