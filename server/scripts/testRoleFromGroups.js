// Historical: authOidcController.js used to map the raw `groups` claim to a
// role in this app's own code. That was superseded on 2026-09-15 by having
// Authentik itself compute and return the role directly via a custom
// `bodorgo_role` scope claim (see roleFromClaim() and
// testRoleFromClaim.js) - Authentik's groups are now named
// bodorgo-admin/bodorgo-member/bodorgo-guest, and the mapping expression
// lives entirely on the Authentik side.
//
// roleFromGroups() is no longer exported from authOidcController.js, so
// it's inlined here rather than imported - this script is kept only as a
// verifiable record of the old design's exact precedence rules, not
// because it's still exercised by the app.
//
// Usage:
//   node scripts/testRoleFromGroups.js

const GROUP_ROLE_ORDER = [
  ['bodorgo-admin', 'admin'],
  ['bodorgo', 'bodorgo'],
  ['bodorgo-guest', 'guest'],
];

function roleFromGroups(groups) {
  if (!Array.isArray(groups)) return null;
  for (const [group, role] of GROUP_ROLE_ORDER) {
    if (groups.includes(group)) return role;
  }
  return 'guest';
}

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
