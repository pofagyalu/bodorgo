// Verifies computeAttendeePayments' arithmetic - a pure function (no DB
// calls), so this exercises it directly against fabricated tour/
// reservation shapes rather than real data, to precisely control the
// scenarios (mixed nights, mixed club/guest roles, subsidy flooring,
// unconfigured pricing, rounding) that matter for correctness.
//
// accommodationPricePerNight is what the whole HOUSE costs per night, not
// a per-person rate - the fixed total (rate × standard nights) gets split
// across attendees proportional to each one's own nights, so everyone's
// share adds up to exactly the real house cost regardless of headcount.
//
// Usage:
//   node scripts/testAttendeePayments.js

import { computeAttendeePayments } from '../src/controllers/reservationController.js';

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

function reservation(id, attendees) {
  return { _id: id, attendees: attendees.map((a, i) => ({ _id: `${id}-a${i}`, ...a })) };
}

// --- Basic case: fixed house fee split proportional to nights, no subsidy ---
{
  // House costs 1000/night for the standard 3 nights -> total fee 3000,
  // split between Alice (3 nights) and Bob (2 nights) proportional to
  // their own nights: 5 person-nights total, 600/person-night.
  const tour = { duration: 4, accommodationPricePerNight: 1000, advancePaymentPercentage: 20, clubSubsidyAmount: 0 };
  const reservations = [
    reservation('r1', [
      { name: 'Alice', nights: 3, user: { role: 'member' } },
      { name: 'Bob', nights: 2, user: { role: 'member' } },
    ]),
  ];
  const { attendeePayments, totals } = computeAttendeePayments(tour, reservations);

  check('two rows returned', attendeePayments.length === 2);
  check('Alice: total 1800 (3 * 600), advance 360, rest 1440', attendeePayments[0].totalPrice === 1800 && attendeePayments[0].advance === 360 && attendeePayments[0].rest === 1440);
  check('Bob: total 1200 (2 * 600), advance 240, rest 960', attendeePayments[1].totalPrice === 1200 && attendeePayments[1].advance === 240 && attendeePayments[1].rest === 960);
  check('totals sum to the full house fee (3000/600/2400)', totals.totalPrice === 3000 && totals.advance === 600 && totals.rest === 2400);
}

// --- Someone attending fewer nights pays less, everyone else picks up the difference proportionally ---
{
  // House fee 3000 total (3 nights * 1000). 3 attendees, one doing 1
  // night less than the standard 3 -> 8 person-nights total, 375/person-night.
  const tour = { duration: 4, accommodationPricePerNight: 1000, advancePaymentPercentage: 0, clubSubsidyAmount: 0 };
  const reservations = [
    reservation('r1', [
      { name: 'Alice', nights: 3, user: { role: 'member' } },
      { name: 'Bob', nights: 3, user: { role: 'member' } },
      { name: 'Casey', nights: 2, user: { role: 'member' } }, // one night less
    ]),
  ];
  const { attendeePayments, totals } = computeAttendeePayments(tour, reservations);
  const byName = Object.fromEntries(attendeePayments.map((p) => [p.name, p]));

  check('Alice/Bob (3 nights each): 1125 each', byName.Alice.totalPrice === 1125 && byName.Bob.totalPrice === 1125);
  check('Casey (2 nights, one less): pays less (750)', byName.Casey.totalPrice === 750);
  check('total collected still equals the real house fee (3000)', totals.totalPrice === 3000);
}

// --- Subsidy: split equally among club members only, deducted from rest only, floored at 0 ---
{
  const tour = { duration: 4, accommodationPricePerNight: 1200, advancePaymentPercentage: 20, clubSubsidyAmount: 3000 };
  const reservations = [
    reservation('r1', [
      { name: 'Alice', nights: 3, user: { role: 'member' } },
      { name: 'Bob', nights: 3, user: { role: 'admin' } }, // admin counts as a club member too
      { name: 'Casey', nights: 3, user: { role: 'guest' } }, // guest: excluded from subsidy
      { name: 'Dana', nights: 1, user: { role: 'member' } }, // small rest, subsidy share would push it negative -> floored at 0
    ]),
  ];
  const { attendeePayments, totals } = computeAttendeePayments(tour, reservations);
  const byName = Object.fromEntries(attendeePayments.map((p) => [p.name, p]));

  // house fee = 1200 * 3 = 3600; person-nights = 3+3+3+1 = 10; rate = 360/person-night
  // subsidyShare = 3000 / 3 club members (Alice, Bob, Dana) = 1000 each
  check('Alice (club, 3 nights): total 1080, advance 216, rest before subsidy 864, after -1000 -> floored at 0', byName.Alice.totalPrice === 1080 && byName.Alice.advance === 216 && byName.Alice.rest === 0);
  check('Bob admin counts as club member too: same numbers as Alice', byName.Bob.totalPrice === 1080 && byName.Bob.rest === 0);
  check('Casey is a guest: no subsidy applied to her rest', byName.Casey.totalPrice === 1080 && byName.Casey.rest === byName.Casey.totalPrice - byName.Casey.advance);
  check('Dana (1 night): total 360, advance 72, rest before subsidy 288, minus 1000 would be negative -> floored at 0', byName.Dana.totalPrice === 360 && byName.Dana.rest === 0);
  check(
    'totals.rest sums the actual (possibly floored) per-row rest values, not a separately-computed figure',
    totals.rest === byName.Alice.rest + byName.Bob.rest + byName.Casey.rest + byName.Dana.rest,
  );
}

// --- Missing `nights` on an attendee (pre-existing data from before this field existed) falls back to duration - 1 ---
{
  const tour = { duration: 5, accommodationPricePerNight: 2000, advancePaymentPercentage: 50, clubSubsidyAmount: 0 };
  const reservations = [reservation('r1', [{ name: 'Eve', user: { role: 'member' } }])]; // no `nights` field at all
  const { attendeePayments } = computeAttendeePayments(tour, reservations);
  check('missing nights falls back to duration - 1 (4)', attendeePayments[0].nights === 4);
  // Sole attendee: house fee 2000*4=8000, person-nights=4, rate=2000/night -> total = 4*2000 = 8000 (all on her)
  check('total computed from the fallback nights (whole house fee, since she is the only attendee)', attendeePayments[0].totalPrice === 8000);
}

// --- Pricing not configured yet on this tour: rows still carry name/nights, but no amounts ---
{
  const tour = { duration: 3 };
  const reservations = [reservation('r1', [{ name: 'Frank', nights: 2, user: { role: 'member' } }])];
  const { attendeePayments, totals } = computeAttendeePayments(tour, reservations);
  check('row still has name/nights when pricing is unset', attendeePayments[0].name === 'Frank' && attendeePayments[0].nights === 2);
  check('amounts are all null when pricing is unset', attendeePayments[0].totalPrice === null && attendeePayments[0].advance === null && attendeePayments[0].rest === null);
  check('totals is null when pricing is unset', totals === null);
}

// --- advancePaymentPercentage of exactly 0 is a valid configured value, not "unset" ---
{
  const tour = { duration: 3, accommodationPricePerNight: 1000, advancePaymentPercentage: 0, clubSubsidyAmount: 0 };
  const reservations = [reservation('r1', [{ name: 'Gina', nights: 2, user: { role: 'member' } }])];
  const { attendeePayments } = computeAttendeePayments(tour, reservations);
  check('0% advance is treated as configured (not null), rest equals full total', attendeePayments[0].advance === 0 && attendeePayments[0].rest === attendeePayments[0].totalPrice);
}

// --- No attendees at all: guard against a divide-by-zero on person-nights ---
{
  const tour = { duration: 3, accommodationPricePerNight: 1000, advancePaymentPercentage: 20, clubSubsidyAmount: 0 };
  const { attendeePayments, totals } = computeAttendeePayments(tour, []);
  check('empty attendee list returns an empty array, not a crash', Array.isArray(attendeePayments) && attendeePayments.length === 0);
  check('totals are all zero, not NaN', totals.totalPrice === 0 && totals.advance === 0 && totals.rest === 0);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
