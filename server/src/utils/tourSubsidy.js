import Transaction from '../models/transactionModel.js';
import { budapestYmd } from './huDate.js';

// The club didn't exist before this date, so it can't have contributed
// money toward a tour's accommodation before it either - see
// reservationController.js's computeAttendeePayments. Guarded on the server
// (not just disabled in the tour-edit form) so a stale/manually-set
// clubSubsidyAmount on an old tour can never actually get applied.
export const CLUB_FOUNDING_DATE = new Date('2019-01-01T00:00:00.000Z');

// What the club really gives toward the tour's accommodation: nothing to a
// tour before the club, or to one quoted in EUR (the form's field is off
// for those too).
export function clubSubsidyOf(tour) {
  if (new Date(tour.startDate) < CLUB_FOUNDING_DATE) return 0;
  if (tour.accommodationCurrency === 'EUR') return 0;
  return tour.clubSubsidyAmount > 0 ? tour.clubSubsidyAmount : 0;
}

// The tour's last day, as a Pénzügyek entry's date: that calendar day (in
// Budapest) at midnight UTC - the same as a date picked on the finance page.
export function tourLastDay(tour) {
  const last = new Date(`${budapestYmd(tour.startDate)}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() + Math.max((tour.duration ?? 1) - 1, 0));
  return last;
}

// Klub hozzájárulása in Klub → Pénzügyek: one Szállásköltség expense per
// tour, kept in step with the tour on every save - its amount, its name and
// its last day follow the tour, and it goes when the amount is 0 (or the
// tour is deleted). `by`: who saved the tour - recorded as the entry's
// author when the entry is new.
export async function syncSubsidyTransaction(tour, by) {
  const amount = clubSubsidyOf(tour);
  if (!amount) {
    await Transaction.deleteMany({ tour: tour._id });
    return;
  }
  await Transaction.updateOne(
    { tour: tour._id },
    {
      $set: {
        date: tourLastDay(tour),
        name: `${tour.title} - szállásköltség támogatás`,
        type: 'expense',
        category: 'Szállásköltség',
        amount,
        currency: 'HUF',
      },
      $setOnInsert: { createdBy: by },
    },
    { upsert: true },
  );
}
