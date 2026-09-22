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
  const tour = { startDate: '2024-01-01', duration: 4, accommodationPricePerNight: 1000, advancePaymentPercentage: 20, clubSubsidyAmount: 0 };
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
  const tour = { startDate: '2024-01-01', duration: 4, accommodationPricePerNight: 1000, advancePaymentPercentage: 0, clubSubsidyAmount: 0 };
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
  const tour = { startDate: '2024-01-01', duration: 4, accommodationPricePerNight: 1200, advancePaymentPercentage: 20, clubSubsidyAmount: 3000 };
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
  const tour = { startDate: '2024-01-01', duration: 5, accommodationPricePerNight: 2000, advancePaymentPercentage: 50, clubSubsidyAmount: 0 };
  const reservations = [reservation('r1', [{ name: 'Eve', user: { role: 'member' } }])]; // no `nights` field at all
  const { attendeePayments } = computeAttendeePayments(tour, reservations);
  check('missing nights falls back to duration - 1 (4)', attendeePayments[0].nights === 4);
  // Sole attendee: house fee 2000*4=8000, person-nights=4, rate=2000/night -> total = 4*2000 = 8000 (all on her)
  check('total computed from the fallback nights (whole house fee, since she is the only attendee)', attendeePayments[0].totalPrice === 8000);
}

// --- Pricing not configured yet on this tour: rows still carry name/nights, but no amounts ---
{
  const tour = { startDate: '2024-01-01', duration: 3 };
  const reservations = [reservation('r1', [{ name: 'Frank', nights: 2, user: { role: 'member' } }])];
  const { attendeePayments, totals } = computeAttendeePayments(tour, reservations);
  check('row still has name/nights when pricing is unset', attendeePayments[0].name === 'Frank' && attendeePayments[0].nights === 2);
  check('amounts are all null when pricing is unset', attendeePayments[0].totalPrice === null && attendeePayments[0].advance === null && attendeePayments[0].rest === null);
  check('totals is null when pricing is unset', totals === null);
}

// --- advancePaymentPercentage of exactly 0 is a valid configured value, not "unset" ---
{
  const tour = { startDate: '2024-01-01', duration: 3, accommodationPricePerNight: 1000, advancePaymentPercentage: 0, clubSubsidyAmount: 0 };
  const reservations = [reservation('r1', [{ name: 'Gina', nights: 2, user: { role: 'member' } }])];
  const { attendeePayments } = computeAttendeePayments(tour, reservations);
  check('0% advance is treated as configured (not null), rest equals full total', attendeePayments[0].advance === 0 && attendeePayments[0].rest === attendeePayments[0].totalPrice);
}

// --- Fractional per-attendee splits round UP (ceiling) for totalPrice/
// advance, so the club never collects less than the real cost - but the
// declared totals must still show the tour's own exact configured numbers
// (e.g. 39000/night * 2 nights = 78000, 20% of that = 15600), not the sum
// of everyone's individually-rounded-up share, which overstates the true
// total (this was a real reported bug: 17 attendees each rounded up by
// ~1 Ft summed to 78013/15606 instead of 78000/15600). The subsidy share
// rounds DOWN (floor), the opposite direction, since that's money the
// club gives away - summing N floored equal shares can never exceed the
// configured budget, whereas ceiling could overspend it. ---
{
  // House fee 1000 (500/night * 2 nights), split 3 ways at 1 night each
  // -> exact share 333.333... per person.
  const tour = { startDate: '2024-01-01', duration: 3, accommodationPricePerNight: 500, advancePaymentPercentage: 33, clubSubsidyAmount: 100 };
  const reservations = [
    reservation('r1', [
      { name: 'Alice', nights: 1, user: { role: 'member' } },
      { name: 'Bob', nights: 1, user: { role: 'member' } },
      { name: 'Casey', nights: 1, user: { role: 'member' } },
    ]),
  ];
  const { attendeePayments, totals } = computeAttendeePayments(tour, reservations);

  check(
    'totalPrice rounds up from 333.33... to 334, not down to 333',
    attendeePayments.every((p) => p.totalPrice === 334),
  );
  check(
    'advance rounds up from 110.22 (33% of 334) to 111, not down to 110',
    attendeePayments.every((p) => p.advance === 111),
  );
  // subsidyShare = floor(100 / 3) = 33, not 34 - flooring means the 3
  // shares (99 total) never exceed the configured 100, unlike ceiling
  // (34 * 3 = 102, overspending by 2).
  check(
    'rest reflects a subsidy share rounded DOWN to 33, not up to 34 (334 - 111 - 33 = 190)',
    attendeePayments.every((p) => p.rest === 190),
  );

  // The individual rows overstate the truth when summed (3 * 334 = 1002,
  // 3 * 111 = 333) - the declared totals must NOT be that sum.
  check(
    'totals.totalPrice is the exact house fee (1000), not the inflated sum of rounded-up rows (1002)',
    totals.totalPrice === 1000,
  );
  check(
    'totals.advance is the exact 33% of 1000 (330), not the inflated sum of rounded-up rows (333)',
    totals.advance === 330,
  );
  check(
    'totals.rest is derived from the exact totals and the subsidy actually used (1000 - 330 - 99 = 571)',
    totals.rest === 571,
  );
}

// --- No attendees at all: guard against a divide-by-zero on person-nights.
// The declared totals still reflect the tour's own configured cost (it
// doesn't depend on headcount) - not zero, just nothing to hand out. ---
{
  const tour = { startDate: '2024-01-01', duration: 3, accommodationPricePerNight: 1000, advancePaymentPercentage: 20, clubSubsidyAmount: 0 };
  const { attendeePayments, totals } = computeAttendeePayments(tour, []);
  check('empty attendee list returns an empty array, not a crash', Array.isArray(attendeePayments) && attendeePayments.length === 0);
  check(
    'totals still reflect the tour\'s configured cost (2000/400/1600), not zero or NaN',
    totals.totalPrice === 2000 && totals.advance === 400 && totals.rest === 1600,
  );
}

// --- The club was founded in 2019 - it can't have contributed to a tour
// that predates it, so clubSubsidyAmount is ignored entirely for one,
// even if a value is (incorrectly) still set on it. ---
{
  const tour = {
    startDate: '2017-06-01', // before the club existed
    duration: 3,
    accommodationPricePerNight: 1000,
    advancePaymentPercentage: 20,
    clubSubsidyAmount: 5000, // should be ignored
  };
  const reservations = [reservation('r1', [{ name: 'Henry', nights: 2, user: { role: 'member' } }])];
  const { attendeePayments } = computeAttendeePayments(tour, reservations);
  check(
    'clubSubsidyAmount is ignored for a pre-2019 tour (rest equals total minus advance, no deduction)',
    attendeePayments[0].rest === attendeePayments[0].totalPrice - attendeePayments[0].advance,
  );
}

// --- perPerson mode: accommodationPricePerNight is the adult rate
// directly, childPricePerNight/childAgeLimitYears distinguish a discount
// by age, evaluated as of the tour's own startDate (not today). Each
// attendee's charge is independent (nights * their own rate), so unlike
// perHouse there's no proportional-split rounding drift to guard against
// - the declared totals are just the sum of the (still ceiled, for the
// same "round in the club's favor" reasoning) individual amounts. ---
{
  const tour = {
    startDate: '2024-06-01',
    duration: 4, // 3 nights
    pricingMode: 'perPerson',
    accommodationPricePerNight: 5000, // adult rate
    childPricePerNight: 3000,
    childAgeLimitYears: 12, // 12 and under is a child
    advancePaymentPercentage: 20,
    clubSubsidyAmount: 0,
  };
  const reservations = [
    reservation('r1', [
      // 30 years old on the tour's startDate - adult.
      { name: 'Adult Alice', nights: 3, user: { role: 'member', birthday: '1994-01-01' } },
      // Exactly 12 on the tour's startDate (birthday just passed) - at
      // the limit, still counts as a child (inclusive).
      { name: 'Child Bob', nights: 3, user: { role: 'member', birthday: '2012-05-01' } },
      // Turns 13 the week after the tour - still 12 (a child) *during*
      // the tour, so must be priced as a child even though today (this
      // test's "now") they might already be 13.
      { name: 'Child Casey', nights: 3, user: { role: 'member', birthday: '2011-06-08' } },
    ]),
  ];
  const { attendeePayments, totals } = computeAttendeePayments(tour, reservations);
  const byName = Object.fromEntries(attendeePayments.map((p) => [p.name, p]));

  check('adult priced at the adult rate (3 * 5000 = 15000)', byName['Adult Alice'].totalPrice === 15000);
  check('child at the exact age limit still gets the child rate (3 * 3000 = 9000)', byName['Child Bob'].totalPrice === 9000);
  check(
    'child priced by age on the tour\'s own startDate, not today (still 9000, not bumped to adult)',
    byName['Child Casey'].totalPrice === 9000,
  );
  check(
    'totals are the sum of independent per-attendee amounts (15000 + 9000 + 9000 = 33000), no shared-pot split at all',
    totals.totalPrice === 33000,
  );
  check('advance totals sum too (20% of 33000 = 6600)', totals.advance === 6600);
}

// --- averagePricePerPersonPerNight - the real, live average once actual
// attendees exist, used to correct the tour-card's advertised price
// instead of leaving it at a pre-registration assumption once reality is
// known to differ. perHouse: fewer than the assumed full capacity
// actually attending pushes the true average UP; perPerson: any child
// attendee at a discount pulls the true blended average DOWN. ---
{
  // perHouse: house fee 3000 (1000/night * 3 nights), but only 2 people
  // (5 person-nights) actually attend instead of some larger assumed
  // capacity - true average is higher than a naive "assume everyone at
  // one rate" figure would suggest for a partially-filled tour.
  const tour = { startDate: '2024-01-01', duration: 4, accommodationPricePerNight: 1000, advancePaymentPercentage: 20, clubSubsidyAmount: 0 };
  const reservations = [
    reservation('r1', [
      { name: 'Alice', nights: 3, user: { role: 'member' } },
      { name: 'Bob', nights: 2, user: { role: 'member' } },
    ]),
  ];
  const { totals } = computeAttendeePayments(tour, reservations);
  check('perHouse: average is the real house fee over real person-nights (3000 / 5 = 600)', totals.averagePricePerPersonPerNight === 600);
}
{
  // perPerson: one adult (5000/night) and two children (3000/night, 3
  // nights each) - blended average must come out below the flat adult
  // rate, reflecting the real discount actually given.
  const tour = {
    startDate: '2024-06-01',
    duration: 4,
    pricingMode: 'perPerson',
    accommodationPricePerNight: 5000,
    childPricePerNight: 3000,
    childAgeLimitYears: 12,
    advancePaymentPercentage: 20,
    clubSubsidyAmount: 0,
  };
  const reservations = [
    reservation('r1', [
      { name: 'Adult', nights: 3, user: { role: 'member', birthday: '1990-01-01' } },
      { name: 'Kid One', nights: 3, user: { role: 'member', birthday: '2015-01-01' } },
      { name: 'Kid Two', nights: 3, user: { role: 'member', birthday: '2016-01-01' } },
    ]),
  ];
  const { totals } = computeAttendeePayments(tour, reservations);
  // (15000 + 9000 + 9000) / 9 person-nights = 3667 (ceiled)
  check(
    'perPerson: blended average reflects the real child discount, well below the flat adult rate (3667, not 5000)',
    totals.averagePricePerPersonPerNight === 3667 && totals.averagePricePerPersonPerNight < tour.accommodationPricePerNight,
  );
}
{
  // No attendees at all - nothing real to average yet.
  const tour = { startDate: '2024-01-01', duration: 3, accommodationPricePerNight: 1000, advancePaymentPercentage: 20, clubSubsidyAmount: 0 };
  const { totals } = computeAttendeePayments(tour, []);
  check('no attendees yet: averagePricePerPersonPerNight is null, nothing to derive it from', totals.averagePricePerPersonPerNight === null);
}

// --- perPerson mode with no childPricePerNight/childAgeLimitYears set at
// all: a perfectly valid "per person, but no child discount" setup -
// everyone just pays the adult rate regardless of age. ---
{
  const tour = {
    startDate: '2024-06-01',
    duration: 3,
    pricingMode: 'perPerson',
    accommodationPricePerNight: 4000,
    advancePaymentPercentage: 10,
    clubSubsidyAmount: 0,
  };
  const reservations = [
    reservation('r1', [{ name: 'Kid', nights: 2, user: { role: 'member', birthday: '2018-01-01' } }]),
  ];
  const { attendeePayments } = computeAttendeePayments(tour, reservations);
  check(
    'with no child rate configured, even a young child pays the adult rate (2 * 4000 = 8000)',
    attendeePayments[0].totalPrice === 8000,
  );
}

// --- perPerson mode, attendee with no birthday on record (e.g. a
// login-less dependent never given one) - can't determine child
// eligibility, so defaults to the adult rate rather than guessing. ---
{
  const tour = {
    startDate: '2024-06-01',
    duration: 3,
    pricingMode: 'perPerson',
    accommodationPricePerNight: 4000,
    childPricePerNight: 2000,
    childAgeLimitYears: 12,
    advancePaymentPercentage: 10,
    clubSubsidyAmount: 0,
  };
  const reservations = [reservation('r1', [{ name: 'No Birthday Nóra', nights: 2, user: { role: 'member' } }])];
  const { attendeePayments } = computeAttendeePayments(tour, reservations);
  check(
    'unknown age (no birthday) defaults to the adult rate, not the child discount (2 * 4000 = 8000)',
    attendeePayments[0].totalPrice === 8000,
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
