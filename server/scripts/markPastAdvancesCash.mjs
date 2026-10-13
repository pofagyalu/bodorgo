// One-off clean-up (2026-10-13): on every tour that has already ended, each
// attendee's advance becomes "cash, taken by an admin" - what
// paymentController.js's recordCashPayment leaves behind: the attendee marked
// paid, and a Succeeded cash Payment recorded by the admin (one per person,
// so a single one can still be undone from the attendee list).
//
//  - nobody paid / marked paid with no record behind it: the cash Payment is
//    created (amount = the advance the tour's pricing gives, 0 if it gives
//    none) and the attendee is marked paid;
//  - an earlier backfilled cash Payment recorded under the attendee's own
//    name (backfillCashPaymentsForLegacyPaid.js): handed over to the admin;
//  - an online (Stripe/Barion) payment: left as it is;
//  - a fee-exempt attendee: left as it is (owes nothing, no payment);
//  - a tour that has not ended yet: not touched.
//
// The admin is INITIAL_ADMIN_USER. No e-mail, no Napló entry, no Transaction.
// Re-running is a no-op.
//
// Dry run by default (only counts) - pass --apply to write.
// Runs against the local .env's database (bodorgo-dev); for production:
//   DB_URI="<live connection string>" node scripts/markPastAdvancesCash.mjs --apply
//
// Usage: node scripts/markPastAdvancesCash.mjs [--apply]
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import Reservation from '../src/models/reservationModel.js';
import Payment from '../src/models/paymentModel.js';
import User from '../src/models/userModel.js';
import { computeAttendeePayments } from '../src/controllers/reservationController.js';
import { tourHasEnded } from '../src/controllers/reviewController.js';

const apply = process.argv.includes('--apply');
await mongoose.connect(config.db.uri);
console.log(`database: ${mongoose.connection.name}${apply ? '' : '  [dry run]'}`);

const admin = await User.findOne({ email: config.initialAdminUser, role: 'admin' }).select('name');
if (!admin) throw new Error(`No admin with the e-mail ${config.initialAdminUser}`);
const adminIds = new Set(
  (await User.find({ role: 'admin' }).select('_id')).map((u) => String(u._id)),
);
console.log(`recorded by: ${admin.name}`);

const sum = { created: 0, markedPaid: 0, handedOver: 0 };
const tours = (await Tour.find()).filter((t) => tourHasEnded(t)).sort((a, b) => a.order - b.order);
for (const tour of tours) {
  const reservations = await Reservation.find({ tour: tour._id }).populate({
    path: 'attendees.user',
    select: 'role birthday familyId',
  });
  const { attendeePayments } = computeAttendeePayments(tour, reservations);
  const row = { created: 0, markedPaid: 0, handedOver: 0 };

  for (const p of attendeePayments) {
    if (p.feeExempt) continue;

    const existing = await Payment.find({
      purpose: 'tourAdvance',
      status: 'Succeeded',
      'attendees.attendeeId': p.attendeeId,
    }).select('method createdBy');

    for (const payment of existing) {
      if (payment.method !== 'cash' || adminIds.has(String(payment.createdBy))) continue;
      row.handedOver++;
      if (apply) await Payment.updateOne({ _id: payment._id }, { createdBy: admin._id });
    }

    if (existing.length === 0) {
      const amount = p.advance ?? 0;
      row.created++;
      if (apply) {
        await Payment.create({
          purpose: 'tourAdvance',
          method: 'cash',
          tour: tour._id,
          createdBy: admin._id,
          attendees: [
            { reservationId: p.reservationId, attendeeId: p.attendeeId, name: p.name, amount },
          ],
          amount,
          status: 'Succeeded',
        });
      }
    }

    if (!p.paid) {
      row.markedPaid++;
      if (apply) {
        await Reservation.updateOne(
          { _id: p.reservationId, 'attendees._id': p.attendeeId },
          { $set: { 'attendees.$.paid': true } },
        );
      }
    }
  }

  for (const key of Object.keys(sum)) sum[key] += row[key];
  if (row.created || row.markedPaid || row.handedOver) {
    console.log(
      `${String(tour.order).padStart(3)}. ${tour.title}: ${row.created} cash payment(s), ${row.markedPaid} marked paid, ${row.handedOver} handed over to the admin`,
    );
  }
}

console.log(
  `\n${tours.length} ended tours; ${apply ? '' : 'would be: '}${sum.created} cash payment(s) created, ${sum.markedPaid} attendee(s) marked paid, ${sum.handedOver} earlier cash payment(s) handed over to the admin.`,
);
if (!apply) console.log('This was a dry run - re-run with --apply to write.');
await mongoose.disconnect();
