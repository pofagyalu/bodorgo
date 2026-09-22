// Verifies buildRegistrationEmails (see reservationController.js) - pure,
// no DB/network, so this is safe to run any time and never sends a real
// email. Covers every wording variant: the registrant registering
// themselves + family, themselves alone, only other people (e.g. an
// admin), and a family member notified about someone else's
// registration (both when the registrant is also attending and when
// they aren't) - plus that eligibility (email/lastLoginAt/
// wantsEmailNotifications) is actually enforced, not just wording.
//
// Usage:
//   node scripts/testBuildRegistrationEmails.js

import { buildRegistrationEmails } from '../src/controllers/reservationController.js';

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

function user(id, name, overrides = {}) {
  return {
    _id: id,
    name,
    email: `${id}@example.com`,
    lastLoginAt: new Date('2026-01-01'),
    wantsEmailNotifications: true,
    ...overrides,
  };
}

// --- Lajos registers himself, his wife Enikő, and their kid Janka ---
{
  const lajos = user('lajos', 'Lajos');
  const eniko = user('eniko', 'Enikő');
  const janka = user('janka', 'Janka');
  const emails = buildRegistrationEmails({
    registrant: lajos,
    tourTitle: 'Szilvásvárad',
    attendeeUsers: [lajos, eniko, janka],
  });

  check('everyone eligible gets exactly one email each', emails.length === 3);

  const toLajos = emails.find((e) => e.to === lajos.email);
  check('Lajos (the registrant, also attending) gets the "gratulálunk...magad és" wording', toLajos.text.includes('Gratulálunk, Lajos! Bebiztosítottad a helyet a magad és az alábbi családtagok számára'));
  check('...listing both Enikő and Janka', toLajos.text.includes('- Enikő') && toLajos.text.includes('- Janka'));

  const toEniko = emails.find((e) => e.to === eniko.email);
  check(
    'Enikő (registered by Lajos, who is also attending) gets the "benevezett magán kívül" wording',
    toEniko.text.includes('Gratulálunk, Enikő! Lajos benevezett magán kívül téged és még az alábbi családtagokat is'),
  );
  check('...listing Janka but not Lajos himself (already named) or herself', toEniko.text.includes('- Janka') && !toEniko.text.includes('- Lajos') && !toEniko.text.includes('- Enikő'));

  const toJanka = emails.find((e) => e.to === janka.email);
  check(
    'Janka (registered by Lajos, also lists Enikő as remaining) gets the same framing with Enikő listed',
    toJanka.text.includes('Lajos benevezett magán kívül téged és még az alábbi családtagokat is') && toJanka.text.includes('- Enikő'),
  );
}

// --- Lajos registers only himself and Enikő (no leftover third person) ---
{
  const lajos = user('lajos2', 'Lajos');
  const eniko = user('eniko2', 'Enikő');
  const emails = buildRegistrationEmails({
    registrant: lajos,
    tourTitle: 'Tamási',
    attendeeUsers: [lajos, eniko],
  });
  const toEniko = emails.find((e) => e.to === eniko.email);
  check(
    'with no one left over besides the two of them, Enikő\'s email drops the list entirely',
    toEniko.text.includes('Lajos benevezett magán kívül téged is a(z) "Tamási" táborra.') && !toEniko.text.includes('\n- '),
  );
}

// --- A member registers only themselves (no family) ---
{
  const solo = user('solo', 'Kovács Zoltán');
  const emails = buildRegistrationEmails({ registrant: solo, tourTitle: 'Sárvár', attendeeUsers: [solo] });
  check('registering only yourself gets exactly one email', emails.length === 1);
  check('...with the "magadnak" wording, no family list', emails[0].text.includes('Bebiztosítottad a helyet magadnak a(z) "Sárvár" táborra.'));
}

// --- An admin registers two members without registering themselves ---
{
  const admin = user('admin1', 'Admin Anna');
  const memberA = user('memberA', 'Tag Anna');
  const memberB = user('memberB', 'Tag Béla');
  const emails = buildRegistrationEmails({
    registrant: admin,
    tourTitle: 'Cserkút',
    attendeeUsers: [memberA, memberB],
  });

  check('admin + both members = 3 emails', emails.length === 3);

  const toAdmin = emails.find((e) => e.to === admin.email);
  check(
    'the admin (not attending) gets the "sikeresen jelentkeztetted" wording, no "gratulálunk" framing for themselves',
    toAdmin.text.includes('Sikeresen jelentkeztetted az alábbi résztvevőket') && !toAdmin.text.startsWith('Gratulálunk'),
  );
  check('...listing both members', toAdmin.text.includes('- Tag Anna') && toAdmin.text.includes('- Tag Béla'));

  const toMemberA = emails.find((e) => e.to === memberA.email);
  check(
    'a member registered by a non-attending admin gets "jelentkeztetett" (no "magán kívül", the admin isn\'t attending)',
    toMemberA.text.includes('Admin Anna jelentkeztetett téged és még az alábbi családtagokat is') && toMemberA.text.includes('- Tag Béla'),
  );
}

// --- Eligibility is actually enforced, not just wording ---
{
  const registrant = user('r', 'Regisztráló Rita');
  const noEmail = user('noEmail', 'Nincs Email', { email: undefined });
  const neverLoggedIn = user('neverLoggedIn', 'Sosem Belépett', { lastLoginAt: undefined });
  const optedOut = user('optedOut', 'Kikapcsolta', { wantsEmailNotifications: false });
  const emails = buildRegistrationEmails({
    registrant,
    tourTitle: 'Őrség',
    attendeeUsers: [registrant, noEmail, neverLoggedIn, optedOut],
  });
  check('only the eligible registrant gets an email - the other 3 are all correctly excluded', emails.length === 1 && emails[0].to === registrant.email);
}

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');
