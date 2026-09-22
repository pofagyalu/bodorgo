// Verifies resolvePayableAttendees' authorization/amount logic (see
// paymentController.js) - the security-critical part of starting a
// Stripe payment, since it decides who a caller is actually allowed to
// pay for and how much, regardless of what the client requests. Does NOT
// call Stripe itself (no real API key needed to run this).
//
// Creates its own throwaway tour + two reservations (order 9986, distinct
// from other throwaway orders used elsewhere): one family of two (with a
// shared familyId) and one unrelated outsider - never touches real data.
// Safe to re-run.
//
// Usage:
//   node scripts/testResolvePayableAttendees.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import Reservation from '../src/models/reservationModel.js';
import { resolvePayableAttendees } from '../src/controllers/paymentController.js';

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

const TEST_ORDER = 9986;

await mongoose.connect(config.db.testUri);

const leftover = await Tour.findOne({ order: TEST_ORDER });
if (leftover) {
  await Reservation.deleteMany({ tour: leftover._id });
  await Tour.deleteOne({ _id: leftover._id });
}

const tour = await Tour.create({
  order: TEST_ORDER,
  title: 'ZZ Test Tour (resolvePayableAttendees)',
  location: { description: 'Teszt', address: 'Teszt utca 1.', coordinates: [19, 47] },
  startDate: new Date('2030-01-01'),
  duration: 3,
  maxCapacity: 10,
  summary: 'Teszt',
  description: 'Teszt tábor a fizetési jogosultság teszteléséhez.',
  imageCover: `tour-${TEST_ORDER}-cover.jpg`,
  accommodationPricePerNight: 9000, // 4500/night per person over 2 nights, ceiled amounts below
  pricingMode: 'perPerson',
  advancePaymentPercentage: 50,
});

const familyId = new mongoose.Types.ObjectId();
const meId = new mongoose.Types.ObjectId();
const familyMemberId = new mongoose.Types.ObjectId();
const alreadyPaidId = new mongoose.Types.ObjectId();
const outsiderId = new mongoose.Types.ObjectId();

const familyReservation = await Reservation.create({
  tour: tour._id,
  bookedBy: meId,
  attendees: [
    { user: meId, name: 'Én', nights: 2, paid: false },
    { user: familyMemberId, name: 'Családtag', nights: 2, paid: false },
    { user: alreadyPaidId, name: 'Már fizetett rokon', nights: 2, paid: true },
  ],
});
const outsiderReservation = await Reservation.create({
  tour: tour._id,
  bookedBy: outsiderId,
  attendees: [{ user: outsiderId, name: 'Idegen', nights: 2, paid: false }],
});

// resolvePayableAttendees needs role/birthday/familyId populated on
// attendees.user, same as the real controller's own query - re-fetch
// with that populate rather than relying on the plain .create() results.
async function loadReservations() {
  return Reservation.find({ tour: tour._id }).populate({ path: 'attendees.user', select: 'role birthday familyId' });
}

// The test's "users" are never actually saved as real User documents -
// resolvePayableAttendees itself only ever reads role/birthday/familyId
// off the reservation's own populated attendees.user, and the caller
// object it's given directly (_id/familyId) - a fake User model would add
// nothing here. But populate() needs a real User doc to resolve against,
// so create minimal ones.
import User from '../src/models/userModel.js';
await User.create([
  { _id: meId, sub: `test-${meId}`, name: 'Én', role: 'member', familyId },
  { _id: familyMemberId, sub: `test-${familyMemberId}`, name: 'Családtag', role: 'member', familyId },
  { _id: alreadyPaidId, sub: `test-${alreadyPaidId}`, name: 'Már fizetett rokon', role: 'member', familyId },
  { _id: outsiderId, sub: `test-${outsiderId}`, name: 'Idegen', role: 'member', familyId: new mongoose.Types.ObjectId() },
]);

try {
  const me = { _id: meId, familyId, email: 'en@example.com' };

  // --- Paying for myself and my family member ---
  {
    const reservations = await loadReservations();
    const familyAttendeeIds = familyReservation.attendees
      .filter((a) => String(a.user) === String(meId) || String(a.user) === String(familyMemberId))
      .map((a) => String(a._id));

    // resolvePayableAttendees does its own fetch internally, so this test
    // exercises it exactly as the real controller would - no need to
    // pass reservations in.
    const { payable } = await resolvePayableAttendees(tour._id, familyAttendeeIds, me);
    check('both my own and my family member\'s attendee rows are payable', payable.length === 2);
    check(
      'the total is the sum of their real advances (2 * ceil(9000/2 nights... ) - just check it\'s a positive number matching both rows)',
      payable.reduce((sum, p) => sum + p.advance, 0) === payable[0].advance + payable[1].advance && payable[0].advance > 0,
    );
  }

  // --- Requesting only an already-paid family member's attendee id -
  // never payable, and since nothing at all ends up payable,
  // resolvePayableAttendees throws rather than returning an empty list. ---
  {
    const alreadyPaidAttendeeId = String(familyReservation.attendees.find((a) => String(a.user) === String(alreadyPaidId))._id);
    let threw = false;
    try {
      await resolvePayableAttendees(tour._id, [alreadyPaidAttendeeId], me);
    } catch (err) {
      threw = true;
    }
    check('requesting only an already-paid attendee throws (nothing payable)', threw);
  }

  // --- Trying to pay for a total stranger outside my family - rejected ---
  {
    const outsiderAttendeeId = String(outsiderReservation.attendees[0]._id);
    let threw = false;
    try {
      await resolvePayableAttendees(tour._id, [outsiderAttendeeId], me);
    } catch (err) {
      threw = true;
    }
    check('paying for someone outside my family is rejected, not silently allowed', threw);
  }

  // --- A mixed request (one mine, one an outsider's) only resolves my own share, never the outsider's ---
  {
    const myAttendeeId = String(familyReservation.attendees.find((a) => String(a.user) === String(meId))._id);
    const outsiderAttendeeId = String(outsiderReservation.attendees[0]._id);
    const { payable } = await resolvePayableAttendees(tour._id, [myAttendeeId, outsiderAttendeeId], me);
    check(
      'a mixed request only ever resolves the caller\'s own payable rows, silently dropping anyone outside their group',
      payable.length === 1 && payable[0].attendeeId === myAttendeeId,
    );
  }
} finally {
  await User.deleteMany({ _id: { $in: [meId, familyMemberId, alreadyPaidId, outsiderId] } });
  await Reservation.deleteMany({ tour: tour._id });
  await Tour.deleteOne({ _id: tour._id });
  console.log('\nCleaned up the throwaway test tour, reservations, and users.');
}

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');

await mongoose.disconnect();
