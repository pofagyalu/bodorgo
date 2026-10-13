// Read-only: where every tour's advance payments stand - per tour, how many
// attendees are marked paid, and what kind of Payment record (if any) stands
// behind each one. Writes nothing.
// Runs against the local .env's database (bodorgo-dev); for production:
//   DB_URI="<live connection string>" node scripts/advancePaymentState.mjs
//
// Usage: node scripts/advancePaymentState.mjs
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import Reservation from '../src/models/reservationModel.js';
import Payment from '../src/models/paymentModel.js';
import User from '../src/models/userModel.js';
import { computeAttendeePayments } from '../src/controllers/reservationController.js';
import { tourHasEnded } from '../src/controllers/reviewController.js';

await mongoose.connect(config.db.uri);
console.log(`database: ${mongoose.connection.name}`);

const adminIds = new Set(
  (await User.find({ role: 'admin' }).select('_id')).map((u) => String(u._id)),
);
const payments = await Payment.find({ purpose: 'tourAdvance', status: 'Succeeded' }).select(
  'method createdBy attendees.attendeeId',
);
// attendeeId -> the kinds of Succeeded payment covering it
const kindsByAttendee = new Map();
for (const p of payments) {
  const kind =
    p.method === 'cash'
      ? adminIds.has(String(p.createdBy))
        ? 'cashAdmin'
        : 'cashOther'
      : p.method;
  for (const a of p.attendees) {
    const key = String(a.attendeeId);
    if (!kindsByAttendee.has(key)) kindsByAttendee.set(key, []);
    kindsByAttendee.get(key).push(kind);
  }
}

const sum = {};
const add = (row, key) => {
  row[key] = (row[key] ?? 0) + 1;
  sum[key] = (sum[key] ?? 0) + 1;
};
const table = [];
for (const tour of (await Tour.find()).sort((a, b) => a.order - b.order)) {
  const reservations = await Reservation.find({ tour: tour._id }).populate({
    path: 'attendees.user',
    select: 'role birthday familyId',
  });
  const { attendeePayments } = computeAttendeePayments(tour, reservations);
  const row = {
    tour: `${tour.order}. ${tour.title}`.slice(0, 34),
    start: tour.startDate?.toISOString().slice(0, 10),
    ended: tourHasEnded(tour) ? 'yes' : 'NO',
    closed: tour.closed ? 'yes' : '',
    advPct: tour.advancePaymentPercentage ?? '-',
  };
  for (const p of attendeePayments) {
    add(row, 'people');
    if (p.feeExempt) add(row, 'exempt');
    if (p.advance == null) add(row, 'noPrice');
    const kinds = kindsByAttendee.get(p.attendeeId) ?? [];
    if (kinds.length > 1) add(row, 'twoPayments');
    if (!p.paid) add(row, kinds.length ? 'unpaidButPayment' : 'unpaid');
    else add(row, kinds.length ? kinds[0] : 'paidNoRecord');
  }
  table.push(row);
}
console.table(table);
console.log('all tours:', sum);
await mongoose.disconnect();
