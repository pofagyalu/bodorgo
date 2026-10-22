import { describe, expect, it } from 'vitest';
import {
  computeAttendeePayments,
  buildRegistrationEmails,
} from '../../src/controllers/reservationController.js';

// computeAttendeePayments is pure (no DB), so these build tour/reservation
// shapes directly. accommodationPricePerNight is what the whole HOUSE costs
// per night: the fixed total (rate x standard nights) is split across the
// attendees proportionally to their own nights.

function reservation(id, attendees) {
  return { _id: id, attendees: attendees.map((a, i) => ({ _id: `${id}-a${i}`, ...a })) };
}
const byName = (payments) => Object.fromEntries(payments.map((p) => [p.name, p]));

describe('computeAttendeePayments - per house', () => {
  it('splits the house fee proportionally to nights', () => {
    const tour = {
      startDate: '2024-01-01',
      duration: 4,
      accommodationPricePerNight: 1000,
      advancePaymentPercentage: 20,
    };
    const { attendeePayments, totals } = computeAttendeePayments(tour, [
      reservation('r1', [
        { name: 'Alice', nights: 3, user: { role: 'member' } },
        { name: 'Bob', nights: 2, user: { role: 'member' } },
      ]),
    ]);
    const p = byName(attendeePayments);
    expect(p.Alice).toMatchObject({ totalPrice: 1800, advance: 360, rest: 1440 });
    expect(p.Bob).toMatchObject({ totalPrice: 1200, advance: 240, rest: 960 });
    expect(totals).toMatchObject({
      totalPrice: 3000,
      advance: 600,
      rest: 2400,
      averagePricePerPersonPerNight: 600,
    });
  });

  it('someone staying one night less pays less, the total is still the house fee', () => {
    const tour = {
      startDate: '2024-01-01',
      duration: 4,
      accommodationPricePerNight: 1000,
      advancePaymentPercentage: 0,
    };
    const { attendeePayments, totals } = computeAttendeePayments(tour, [
      reservation('r1', [
        { name: 'Alice', nights: 3, user: { role: 'member' } },
        { name: 'Bob', nights: 3, user: { role: 'member' } },
        { name: 'Casey', nights: 2, user: { role: 'member' } },
      ]),
    ]);
    const p = byName(attendeePayments);
    expect(p.Alice.totalPrice).toBe(1125);
    expect(p.Casey.totalPrice).toBe(750);
    expect(totals.totalPrice).toBe(3000);
  });

  it('applies the club subsidy to members and admins only, never below zero', () => {
    const tour = {
      startDate: '2024-01-01',
      duration: 4,
      accommodationPricePerNight: 1200,
      advancePaymentPercentage: 20,
      clubSubsidyAmount: 3000,
    };
    const { attendeePayments, totals } = computeAttendeePayments(tour, [
      reservation('r1', [
        { name: 'Alice', nights: 3, user: { role: 'member' } },
        { name: 'Bob', nights: 3, user: { role: 'admin' } },
        { name: 'Casey', nights: 3, user: { role: 'guest' } },
        { name: 'Dana', nights: 1, user: { role: 'member' } },
      ]),
    ]);
    const p = byName(attendeePayments);
    expect(p.Alice).toMatchObject({ totalPrice: 1080, advance: 216, rest: 0 });
    expect(p.Bob.rest).toBe(0);
    expect(p.Casey.rest).toBe(p.Casey.totalPrice - p.Casey.advance);
    expect(p.Dana).toMatchObject({ totalPrice: 360, rest: 0 });
    expect(totals.rest).toBe(p.Alice.rest + p.Bob.rest + p.Casey.rest + p.Dana.rest);
  });

  it('ignores the subsidy for a tour before the club was founded (2019)', () => {
    const tour = {
      startDate: '2017-06-01',
      duration: 3,
      accommodationPricePerNight: 1000,
      advancePaymentPercentage: 20,
      clubSubsidyAmount: 5000,
    };
    const [row] = computeAttendeePayments(tour, [
      reservation('r1', [{ name: 'H', nights: 2, user: { role: 'member' } }]),
    ]).attendeePayments;
    expect(row.rest).toBe(row.totalPrice - row.advance);
  });

  it('rounds each row up, the subsidy share down, and keeps the totals exact', () => {
    const tour = {
      startDate: '2024-01-01',
      duration: 3,
      accommodationPricePerNight: 500,
      advancePaymentPercentage: 33,
      clubSubsidyAmount: 100,
    };
    const { attendeePayments, totals } = computeAttendeePayments(tour, [
      reservation(
        'r1',
        ['A', 'B', 'C'].map((name) => ({ name, nights: 1, user: { role: 'member' } })),
      ),
    ]);
    for (const p of attendeePayments)
      expect(p).toMatchObject({ totalPrice: 334, advance: 111, rest: 190 });
    expect(totals).toMatchObject({ totalPrice: 1000, advance: 330, rest: 571 });
  });

  it('falls back to duration - 1 nights when an attendee has none recorded', () => {
    const tour = {
      startDate: '2024-01-01',
      duration: 5,
      accommodationPricePerNight: 2000,
      advancePaymentPercentage: 50,
    };
    const [row] = computeAttendeePayments(tour, [
      reservation('r1', [{ name: 'Eve', user: { role: 'member' } }]),
    ]).attendeePayments;
    expect(row.nights).toBe(4);
    expect(row.totalPrice).toBe(8000);
  });

  it('treats a 0% advance as configured: the rest is the whole price', () => {
    const tour = {
      startDate: '2024-01-01',
      duration: 3,
      accommodationPricePerNight: 1000,
      advancePaymentPercentage: 0,
    };
    const [row] = computeAttendeePayments(tour, [
      reservation('r1', [{ name: 'G', nights: 2, user: { role: 'member' } }]),
    ]).attendeePayments;
    expect(row.advance).toBe(0);
    expect(row.rest).toBe(row.totalPrice);
    expect(row.paid).toBe(false);
  });

  it('a fee-exempt attendee pays nothing and is left out of the split', () => {
    const tour = {
      startDate: '2024-01-01',
      duration: 3,
      accommodationPricePerNight: 1000,
      advancePaymentPercentage: 20,
    };
    const { attendeePayments } = computeAttendeePayments(tour, [
      reservation('r1', [
        { name: 'Payer', nights: 2, user: { role: 'member' } },
        { name: 'Free', nights: 2, feeExempt: true, user: { role: 'member' } },
      ]),
    ]);
    const p = byName(attendeePayments);
    expect(p.Free).toMatchObject({
      totalPrice: 0,
      advance: 0,
      rest: 0,
      paid: true,
      feeExempt: true,
    });
    expect(p.Payer.totalPrice).toBe(2000);
  });

  it('keeps the configured totals for a tour with no attendees yet', () => {
    const tour = {
      startDate: '2024-01-01',
      duration: 3,
      accommodationPricePerNight: 1000,
      advancePaymentPercentage: 20,
    };
    const { attendeePayments, totals } = computeAttendeePayments(tour, []);
    expect(attendeePayments).toEqual([]);
    expect(totals).toMatchObject({ totalPrice: 2000, advance: 400, rest: 1600 });
  });
});

describe('computeAttendeePayments - once the advances are declared paid', () => {
  // Attendee ids are `${reservationId}-a${index}` (see reservation above).
  it('per house: who paid keeps what they paid, a latecomer pays it all on site', () => {
    // The house: 30 000 Ft a night, 2 nights = 60 000 Ft, 20% advance.
    // A and B paid 6 000 Ft each while they were two (30 000 Ft each);
    // then C joined: 20 000 Ft each now.
    const tour = {
      startDate: '2024-01-01',
      duration: 3,
      accommodationPricePerNight: 30000,
      advancePaymentPercentage: 20,
      advancePaidAt: new Date('2024-01-01'),
    };
    const { attendeePayments, totals } = computeAttendeePayments(
      tour,
      [
        reservation('r1', [
          { name: 'A', nights: 2, paid: true, user: { role: 'guest' } },
          { name: 'B', nights: 2, paid: true, user: { role: 'guest' } },
          { name: 'C', nights: 2, user: { role: 'guest' } },
        ]),
      ],
      new Map([
        ['r1-a0', 6000],
        ['r1-a1', 6000],
      ]),
    );
    const p = byName(attendeePayments);
    expect(p.A).toMatchObject({ totalPrice: 20000, advance: 6000, rest: 14000, onSite: false });
    expect(p.C).toMatchObject({
      totalPrice: 20000,
      advance: 0,
      advanceInCurrency: 0,
      rest: 20000,
      onSite: true,
    });
    expect(totals).toMatchObject({ totalPrice: 60000, advance: 12000, rest: 48000 });
  });

  it('a EUR tour: the paid forints back in euros; no record - the worked-out advance', () => {
    const tour = {
      startDate: '2026-10-22',
      duration: 4,
      pricingMode: 'perPerson',
      accommodationPricePerNight: 11,
      accommodationCurrency: 'EUR',
      eurHufExchangeRate: 365,
      advancePaymentPercentage: 20,
      advancePaidAt: new Date('2026-09-22'),
    };
    const { attendeePayments, totals } = computeAttendeePayments(
      tour,
      [
        reservation('r1', [
          // Paid 7 € (2 555 Ft) under the old whole-euro rounding.
          { name: 'Paid', nights: 3, paid: true, user: { role: 'member' } },
          // Ticked paid by hand, no Payment record: 6,60 € worked out.
          { name: 'Ticked', nights: 3, paid: true, user: { role: 'member' } },
          { name: 'Late', nights: 3, user: { role: 'member' } },
        ]),
      ],
      new Map([
        ['r1-a0', 2555],
        // Someone who withdrew since: their 6 € (2 190 Ft) still came in.
        ['gone', 2190],
      ]),
    );
    const p = byName(attendeePayments);
    expect(p.Paid).toMatchObject({ advance: 2555, advanceInCurrency: 7, rest: 26 });
    expect(p.Ticked).toMatchObject({ advance: 2409, advanceInCurrency: 6.6, rest: 26.4 });
    expect(p.Late).toMatchObject({ advance: 0, rest: 33, onSite: true });
    expect(totals).toMatchObject({
      totalPrice: 99,
      advance: 2555 + 2409,
      advanceInCurrency: 13.6,
      rest: 85.4,
      // Everything that came in, the withdrawn one's too.
      advancePaidTotal: 2555 + 2409 + 2190,
      advancePaidTotalInCurrency: 19.6,
    });
  });

  it('nothing changes before they are declared paid', () => {
    const tour = {
      startDate: '2024-01-01',
      duration: 2,
      accommodationPricePerNight: 10000,
      advancePaymentPercentage: 10,
    };
    const [row] = computeAttendeePayments(
      tour,
      [reservation('r1', [{ name: 'H', nights: 1, user: { role: 'guest' } }])],
      new Map([['r1-a0', 5000]]),
    ).attendeePayments;
    expect(row).toMatchObject({ advance: 1000, rest: 9000, onSite: false });
  });
});

describe('computeAttendeePayments - per person and unconfigured', () => {
  it('prices children (by age on the tour start date) at the child rate', () => {
    const tour = {
      startDate: '2024-06-01',
      duration: 4,
      pricingMode: 'perPerson',
      accommodationPricePerNight: 5000,
      childPricePerNight: 3000,
      childAgeLimitYears: 12,
      advancePaymentPercentage: 20,
    };
    const { attendeePayments, totals } = computeAttendeePayments(tour, [
      reservation('r1', [
        { name: 'Adult', nights: 3, user: { role: 'member', birthday: '1994-01-01' } },
        { name: 'AtLimit', nights: 3, user: { role: 'member', birthday: '2012-05-01' } },
        { name: 'Turning13Later', nights: 3, user: { role: 'member', birthday: '2011-06-08' } },
      ]),
    ]);
    const p = byName(attendeePayments);
    expect(p.Adult.totalPrice).toBe(15000);
    expect(p.AtLimit.totalPrice).toBe(9000);
    expect(p.Turning13Later.totalPrice).toBe(9000);
    expect(totals).toMatchObject({ totalPrice: 33000, advance: 6600 });
  });

  it('a EUR tour: prices to the cent (rounded up), only the advance in HUF', () => {
    const tour = {
      startDate: '2024-01-01',
      duration: 4,
      accommodationPricePerNight: 100, // the house, per night: 300 € in all
      accommodationCurrency: 'EUR',
      eurHufExchangeRate: 395.5,
      advancePaymentPercentage: 25,
      clubSubsidyAmount: 30000, // not given on a EUR tour
    };
    const { attendeePayments, totals } = computeAttendeePayments(tour, [
      reservation('r1', [
        { name: 'A', nights: 3, user: { role: 'member' } },
        { name: 'B', nights: 3, user: { role: 'member' } },
        { name: 'C', nights: 1, user: { role: 'guest' } },
      ]),
    ]);
    const p = byName(attendeePayments);
    // 300 € / 7 person-nights: A 128.5714 -> 128.58 €, advance 25% = 32.145
    // -> 32.15 €, in HUF 32.15 * 395.5 = 12715.325 -> 12716 Ft.
    expect(p.A).toMatchObject({
      totalPrice: 128.58,
      advanceInCurrency: 32.15,
      advance: 12716,
      rest: 96.43,
    });
    // C: 42.857 -> 42.86 €, 10.715 -> 10.72 €, 10.72 * 395.5 = 4239.76 -> 4240 Ft.
    expect(p.C).toMatchObject({
      totalPrice: 42.86,
      advanceInCurrency: 10.72,
      advance: 4240,
      rest: 32.14,
    });
    expect(totals).toMatchObject({
      totalPrice: 300,
      advanceInCurrency: 75,
      advance: Math.ceil(75 * 395.5),
      rest: 225, // no subsidy taken off
      // The tour card's Ft/fő/éj stays in HUF.
      averagePricePerPersonPerNight: Math.ceil((300 / 7) * 395.5),
    });
  });

  it('a EUR tour per person: no floating-point crumbs add a forint or a cent', () => {
    // Tátrai ősz: 11 €/night, 3 nights, 20% advance at 365 Ft/€.
    const tour = {
      startDate: '2026-10-22',
      duration: 4,
      pricingMode: 'perPerson',
      accommodationPricePerNight: 11,
      accommodationCurrency: 'EUR',
      eurHufExchangeRate: 365,
      advancePaymentPercentage: 20,
    };
    const { attendeePayments, totals } = computeAttendeePayments(tour, [
      reservation('r1', [
        { name: 'A', nights: 3, user: { role: 'member' } },
        { name: 'B', nights: 3, user: { role: 'member' } },
      ]),
    ]);
    // 6.6 * 365 is 2409.0000000000005 in floating point - still 2409 Ft.
    expect(byName(attendeePayments).A).toMatchObject({
      totalPrice: 33,
      advanceInCurrency: 6.6,
      advance: 2409,
      rest: 26.4,
    });
    expect(totals).toMatchObject({
      totalPrice: 66,
      advanceInCurrency: 13.2,
      advance: 4818,
      rest: 52.8,
    });
  });

  it('a HUF tour: the advance is the same in both fields', () => {
    const tour = {
      startDate: '2024-01-01',
      duration: 2,
      accommodationPricePerNight: 10000,
      advancePaymentPercentage: 10,
    };
    const [row] = computeAttendeePayments(tour, [
      reservation('r1', [{ name: 'H', nights: 1, user: { role: 'member' } }]),
    ]).attendeePayments;
    expect(row).toMatchObject({ totalPrice: 10000, advance: 1000, advanceInCurrency: 1000 });
  });

  it('returns rows without amounts while pricing is not set up', () => {
    const tour = { startDate: '2024-01-01', duration: 3 };
    const { attendeePayments, totals } = computeAttendeePayments(tour, [
      reservation('r1', [
        {
          name: 'F',
          nights: 2,
          paid: true,
          user: { _id: 'u1', role: 'member', familyId: 'fam-1' },
        },
        { name: 'G', nights: 2, user: { role: 'guest' } },
      ]),
    ]);
    expect(totals).toBeNull();
    expect(attendeePayments[0]).toMatchObject({
      name: 'F',
      nights: 2,
      userId: 'u1',
      familyId: 'fam-1',
      paid: true,
      totalPrice: null,
    });
    expect(attendeePayments[1]).toMatchObject({
      familyId: null,
      paid: false,
      advance: null,
      rest: null,
    });
  });
});

describe('buildRegistrationEmails', () => {
  const eligible = (id, name) => ({
    _id: id,
    name,
    email: `${id}@test.local`,
    lastLoginAt: new Date(),
  });

  it('greets someone who registered themselves and their family', () => {
    const me = eligible('me', 'Én');
    const kid = { _id: 'kid', name: 'Gyerek' }; // no email: gets no email
    const emails = buildRegistrationEmails({
      registrant: me,
      tourTitle: 'Mátra',
      attendeeUsers: [me, kid],
    });
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toBe('me@test.local');
    expect(emails[0].subject).toBe('Sikeres jelentkezés - Mátra');
    expect(emails[0].text).toContain('magad és az alábbi családtagok');
    expect(emails[0].text).toContain('- Gyerek');
  });

  it('tells a family member who registered them', () => {
    const me = eligible('me', 'Én');
    const spouse = eligible('sp', 'Párom');
    const emails = buildRegistrationEmails({
      registrant: me,
      tourTitle: 'Mátra',
      attendeeUsers: [me, spouse],
    });
    const toSpouse = emails.find((e) => e.to === 'sp@test.local');
    expect(toSpouse.text).toContain('Én benevezett magán kívül téged is');
  });

  it('an admin registering only others gets a plain confirmation', () => {
    const admin = eligible('ad', 'Admin');
    const other = { _id: 'ot', name: 'Valaki', email: 'x@test.local' }; // never logged in: no email
    const emails = buildRegistrationEmails({
      registrant: admin,
      tourTitle: 'T',
      attendeeUsers: [other],
    });
    expect(emails).toHaveLength(1);
    expect(emails[0].text).toContain('Sikeresen jelentkeztetted');
  });

  it('skips people who turned email notifications off', () => {
    const me = { ...eligible('me', 'Én'), wantsEmailNotifications: false };
    expect(
      buildRegistrationEmails({ registrant: me, tourTitle: 'T', attendeeUsers: [me] }),
    ).toEqual([]);
  });
});
