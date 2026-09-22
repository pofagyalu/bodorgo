// One-off migration: backfills each existing reservation's new per-
// attendee `paid` field (see reservationModel.js's attendeeSchema.paid)
// from that reservation's own whole-booking `paid` value, so existing
// data keeps showing the same paid/unpaid status it already did before
// this field existed - going forward, the two can genuinely diverge
// (different family members paying at different times via the
// self-service "Előleg befizetés" flow), which is exactly why this
// migration exists.
//
// Reads via .lean() rather than a normal hydrated find() - Mongoose
// applies a schema's `default` to a missing path even for documents
// already in the database (confirmed by hand: a hydrated read reports
// `false`, the schema default, for an attendee that has no `paid` field
// in the database at all - only .lean()/the raw driver correctly shows
// `undefined`). Using a normal find() here would make every attendee
// look like it already has a real (defaulted) value, and this migration
// would silently do nothing.
//
// Only touches attendees that don't already have their own `paid` value
// recorded in the database - safe to re-run, and won't clobber anything
// a real payment (via the self-service flow, once that's wired up) has
// already set for someone individually.
//
// Usage:
//   node scripts/migrateAttendeePaidField.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Reservation from '../src/models/reservationModel.js';

await mongoose.connect(config.db.uri);

const reservations = await Reservation.find().lean();

let reservationsTouched = 0;
let attendeesTouched = 0;

for (const reservation of reservations) {
  const attendeesNeedingBackfill = reservation.attendees.filter((a) => a.paid === undefined);
  if (attendeesNeedingBackfill.length === 0) continue;

  const updatedAttendees = reservation.attendees.map((a) =>
    a.paid === undefined ? { ...a, paid: reservation.paid } : a,
  );

  await Reservation.updateOne({ _id: reservation._id }, { $set: { attendees: updatedAttendees } });
  reservationsTouched++;
  attendeesTouched += attendeesNeedingBackfill.length;
}

console.log(
  `Backfilled paid on ${attendeesTouched} attendee(s) across ${reservationsTouched} reservation(s) (of ${reservations.length} total).`,
);

await mongoose.disconnect();
