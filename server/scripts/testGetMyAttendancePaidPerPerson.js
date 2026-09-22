// Verifies getMyAttendance reports each attendee's OWN paid status, not
// the whole reservation's - the real bug this was fixing: two people
// sharing one family reservation used to always show the same paid/
// unpaid status together, even though (especially with the self-service
// "Előleg befizetés" flow) they can genuinely pay at different times.
//
// Finds a real reservation with at least 2 attendees, temporarily sets
// one attendee's paid to true and another's to false (deliberately
// different from each other), calls getMyAttendance as each of those two
// real users, and confirms they see their own differing status despite
// sharing the same reservation - then restores the original values.
//
// Usage:
//   node scripts/testGetMyAttendancePaidPerPerson.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Reservation from '../src/models/reservationModel.js';
import User from '../src/models/userModel.js';
// Unused directly, but getMyAttendance's own .populate('tour', ...) needs
// the Tour schema registered on this connection.
import '../src/models/tourModel.js';
import { getMyAttendance } from '../src/controllers/userController.js';

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

await mongoose.connect(config.db.testUri);

const reservation = await Reservation.findOne({ 'attendees.1': { $exists: true } });
if (!reservation) {
  console.error('No reservation with at least 2 attendees found - cannot run this check.');
  process.exit(1);
}

const [attendeeA, attendeeB] = reservation.attendees;
const original = { a: attendeeA.paid, b: attendeeB.paid };

try {
  attendeeA.paid = true;
  attendeeB.paid = false;
  await reservation.save();

  const userA = await User.findById(attendeeA.user);
  const userB = await User.findById(attendeeB.user);

  const resA = fakeRes();
  await getMyAttendance({ user: userA }, resA);
  const tourEntryA = resA.body.data.tours.find((t) => String(t.tour._id) === String(reservation.tour));
  check(`${userA.name} sees their own paid=true, not the reservation's shared value`, tourEntryA?.paid === true);

  const resB = fakeRes();
  await getMyAttendance({ user: userB }, resB);
  const tourEntryB = resB.body.data.tours.find((t) => String(t.tour._id) === String(reservation.tour));
  check(`${userB.name} (same reservation) sees their own paid=false, different from ${userA.name}`, tourEntryB?.paid === false);
} finally {
  const fresh = await Reservation.findById(reservation._id);
  fresh.attendees[0].paid = original.a;
  fresh.attendees[1].paid = original.b;
  await fresh.save();
  console.log('\nRestored the reservation to its original paid values.');
}

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');

await mongoose.disconnect();
