// Verifies hungarianFromSuffix (see utils/hungarianGrammar.js) against a
// broad set of real Hungarian town names plus a few Hungarianized foreign
// ones - pure, no DB/network, safe to run any time. This is a heuristic
// (vowel harmony + final a/e lengthening), not a dictionary, so it won't
// be flawless for every genuinely irregular Hungarian exception - this
// test exists to prove it's right for the overwhelming common case, not
// to claim 100% linguistic correctness.
//
// Usage:
//   node scripts/testHungarianFromSuffix.js

import { hungarianFromSuffix } from '../src/utils/hungarianGrammar.js';

let failures = 0;
function check(place, expected) {
  const actual = hungarianFromSuffix(place);
  const ok = actual === expected;
  console.log(`${ok ? '✓' : '✗'} ${place} -> ${actual}${ok ? '' : ` (expected ${expected})`}`);
  if (!ok) failures++;
}

// Bare final a/e lengthening (the trickiest rule).
check('Pápa', 'Pápától');
check('Nyíregyháza', 'Nyíregyházától');
check('Vecse', 'Vecsétől');

// Back-vowel harmony (-tól), no lengthening needed (doesn't end in a/e).
check('Leányfalu', 'Leányfalutól'); // the exact example from the request
check('Vác', 'Váctól');
check('Miskolc', 'Miskolctól');
check('Sopron', 'Soprontól');
check('Székesfehérvár', 'Székesfehérvártól');
check('Győr', 'Győrtől'); // ő is a front vowel despite Győr "feeling" back-ish

// Front-vowel harmony (-től).
check('Budapest', 'Budapesttől');
check('Debrecen', 'Debrecentől');
check('Pécs', 'Pécstől');
check('Eger', 'Egertől');
check('Kecskemét', 'Kecskeméttől');

// Hungarianized foreign place names (a Romanian friend's address) - the
// same rule a Hungarian speaker applies to any noun, regardless of origin.
check('Oradea', 'Oradeától');
check('Temesvár', 'Temesvártól'); // Hungarian exonym for Timișoara
check('Kolozsvár', 'Kolozsvártól'); // Hungarian exonym for Cluj-Napoca

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');
