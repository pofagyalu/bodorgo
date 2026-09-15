// Sanity check for authOidcController.js's roleFromClaim() - the pure
// function validating the `bodorgo_role` claim Authentik now computes and
// sends directly (via a custom scope/property mapping, see
// authentik-integration-instructions.md), replacing the old approach of
// mapping raw group names to a role in this app's own code (see
// testRoleFromGroups.js for that superseded design).
//
// Usage:
//   node scripts/testRoleFromClaim.js

import { roleFromClaim } from '../src/controllers/authOidcController.js';

const cases = [
  { bodorgoRole: 'admin', expected: 'admin' },
  { bodorgoRole: 'member', expected: 'member' },
  { bodorgoRole: 'guest', expected: 'guest' },
  // Not enrolled in any bodorgo-* group - Authentik's expression itself
  // returns None/null for this case.
  { bodorgoRole: null, expected: null },
  // The scope/claim wasn't sent at all (misconfigured provider).
  { bodorgoRole: undefined, expected: null },
  // Anything not exactly one of the three valid values is rejected, not
  // passed through - guards against a typo'd expression on Authentik's side.
  { bodorgoRole: 'bodorgo-admin', expected: null },
  { bodorgoRole: '', expected: null },
];

let failures = 0;
for (const { bodorgoRole, expected } of cases) {
  const actual = roleFromClaim(bodorgoRole);
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} roleFromClaim(${JSON.stringify(bodorgoRole)}) = ${actual} (expected ${expected})`);
}

if (failures > 0) {
  console.error(`\n${failures} case(s) failed.`);
  process.exit(1);
}
console.log('\nAll cases passed.');
