// One-time backfill: creates a cash Payment record (method: 'cash',
// status: 'Succeeded') for every attendee that's already marked paid
// (attendees.paid === true) but has no Payment record of any kind behind
// it - i.e. everyone marked paid before this app tracked *how* an advance
// was paid at all (imported/legacy data, the pre-Stripe era, or the 0%-
// advance auto-mark). Without this, those rows show a plain "Fizetve"
// badge on the profile page with no icon, since getMyAttendance can't
// tell what settled them.
//
// Real amount used where the tour's own pricing can still compute one
// (computeAttendeePayments' advance); falls back to 0 (flagged in the
// output) for a tour with no pricing configured at all, since there's no
// way to reconstruct a real figure for those.
//
// Only ever creates - never touches an attendee that already has a
// matching Payment (of ANY method), so re-running this is a no-op the
// second time. Safe to run against real data.
//
// Usage:
//   node scripts/backfillCashPaymentsForLegacyPaid.js            (dry run)
//   node scripts/backfillCashPaymentsForLegacyPaid.js --apply    (writes)

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import Reservation from '../src/models/reservationModel.js';
import Payment from '../src/models/paymentModel.js';
import { computeAttendeePayments } from '../src/controllers/reservationController.js';

const apply = process.argv.includes('--apply');

await mongoose.connect(config.db.uri);

const tours = await Tour.find();
let created = 0;
let unknownAmount = 0;

for (const tour of tours) {
  const reservations = await Reservation.find({ tour: tour._id }).populate({
    path: 'attendees.user',
    select: 'role birthday familyId',
  });
  if (reservations.length === 0) continue;

  const { attendeePayments } = computeAttendeePayments(tour, reservations);

  for (const p of attendeePayments) {
    if (!p.paid) continue;

    const existing = await Payment.findOne({
      purpose: 'tourAdvance',
      status: 'Succeeded',
      'attendees.attendeeId': p.attendeeId,
    }).select('_id');
    if (existing) continue;

    const amount = p.advance ?? 0;
    if (p.advance == null) unknownAmount++;

    console.log(
      `${apply ? 'Creating' : '[dry run] Would create'} cash Payment: tour="${tour.title}" (order ${tour.order}), attendee="${p.name}", amount=${amount}${p.advance == null ? ' (unknown - tour has no pricing configured)' : ''}`,
    );

    if (apply) {
      await Payment.create({
        purpose: 'tourAdvance',
        method: 'cash',
        tour: tour._id,
        createdBy: p.userId,
        attendees: [
          { reservationId: p.reservationId, attendeeId: p.attendeeId, name: p.name, amount },
        ],
        amount,
        status: 'Succeeded',
      });
    }
    created++;
  }
}

console.log(
  `\n${apply ? 'Created' : 'Would create'} ${created} backfilled cash Payment record(s), ${unknownAmount} with an unknown (0) amount.`,
);
if (!apply) {
  console.log('This was a dry run - re-run with --apply to actually write these.');
}

await mongoose.disconnect();
process.exit(0);
