// Temporary CLI utility for recording historical attendance on a tour -
// step 3 of the three-pass workflow (see addTour.js's header comment).
//
// Attendees are resolved from an existing family's roster (see
// createFamily.js / addFamilyMember.js / listFamily.js) rather than by a
// global, exact-name search - that used to risk silently misattributing
// someone whenever two different families happened to share a name, or a
// name was typed slightly differently across years, which would corrupt
// the per-person "which tours did I attend" statistics this is all for.
//
// Usage:
//   node scripts/create-reservation.js <tourId|order|slug> <familyAnchor> [options]
//
// <familyAnchor> identifies any member of the family - their email, or (if
// they have none) their exact name.
//
// Options:
//   --only "Name1,Name2"   Only these family members attended, not
//                          everyone - by exact name, comma-separated.
//   --booked-by <anchor>   Who actually made the booking (email or exact
//                          name). Defaults to <familyAnchor> itself.
//   --unpaid               Mark the reservation as not yet paid (default:
//                          paid, since this is normally used for already-
//                          settled historical data).
//
// Family members already registered for this tour (from a previous run)
// are skipped automatically rather than duplicated.

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import User from '../src/models/userModel.js';
import Reservation from '../src/models/reservationModel.js';

const rawArgs = process.argv.slice(2);
const positional = [];
const flags = {};
for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i];
  if (arg === '--unpaid') flags.unpaid = true;
  else if (arg === '--only') flags.only = rawArgs[++i];
  else if (arg === '--booked-by') flags.bookedBy = rawArgs[++i];
  else positional.push(arg);
}

const [tourIdentifier, familyAnchor] = positional;

if (!tourIdentifier || !familyAnchor) {
  console.error(
    'Usage: node scripts/create-reservation.js <tourId|order|slug> <familyAnchor> [--only "Name1,Name2"] [--booked-by <anchor>] [--unpaid]',
  );
  process.exit(1);
}

async function findByAnchor(anchor) {
  return anchor.includes('@')
    ? User.findOne({ email: anchor.toLowerCase() })
    : User.findOne({ name: anchor });
}

await mongoose.connect(config.db.testUri);

let tour;
if (mongoose.isValidObjectId(tourIdentifier)) {
  tour = await Tour.findById(tourIdentifier);
} else if (/^\d+$/.test(tourIdentifier)) {
  tour = await Tour.findOne({ order: Number(tourIdentifier) });
} else {
  tour = await Tour.findOne({ slug: tourIdentifier });
}
if (!tour) {
  console.error(`No tour found matching "${tourIdentifier}"`);
  await mongoose.disconnect();
  process.exit(1);
}

const anchorUser = await findByAnchor(familyAnchor);
if (!anchorUser) {
  console.error(`No user found matching "${familyAnchor}"`);
  await mongoose.disconnect();
  process.exit(1);
}
if (!anchorUser.familyId) {
  console.error(`${anchorUser.name} doesn't belong to a family yet - run createFamily.js first.`);
  await mongoose.disconnect();
  process.exit(1);
}

let members = await User.find({ familyId: anchorUser.familyId }).sort('name');

if (flags.only) {
  const wanted = flags.only.split(',').map((s) => s.trim());
  const missing = wanted.filter((w) => !members.some((m) => m.name === w));
  if (missing.length) {
    console.error(`Not found in this family: ${missing.join(', ')}`);
    await mongoose.disconnect();
    process.exit(1);
  }
  members = members.filter((m) => wanted.includes(m.name));
}

let bookedByUser = anchorUser;
if (flags.bookedBy) {
  bookedByUser = await findByAnchor(flags.bookedBy);
  if (!bookedByUser) {
    console.error(`No user found matching --booked-by "${flags.bookedBy}"`);
    await mongoose.disconnect();
    process.exit(1);
  }
}

const existingReservations = await Reservation.find({ tour: tour._id }).select('attendees.user');
const alreadyRegisteredIds = new Set(
  existingReservations.flatMap((r) => r.attendees.map((a) => a.user.toString())),
);

const attendees = members.filter((m) => !alreadyRegisteredIds.has(m._id.toString()));
const skipped = members.filter((m) => alreadyRegisteredIds.has(m._id.toString()));

if (skipped.length) {
  console.log(`Already registered for this tour, skipping: ${skipped.map((m) => m.name).join(', ')}`);
}

if (attendees.length === 0) {
  console.error('Everyone in this selection is already registered for this tour - nothing to do.');
  await mongoose.disconnect();
  process.exit(1);
}

const reservation = await Reservation.create({
  tour: tour._id,
  bookedBy: bookedByUser._id,
  // paid is set on each attendee individually now (the real source of
  // truth - see reservationModel.js's attendeeSchema.paid), not just the
  // whole reservation - this --unpaid flag still applies uniformly to
  // everyone in this one-shot creation, same as before.
  attendees: attendees.map((m) => ({ user: m._id, name: m.name, paid: !flags.unpaid })),
  paid: !flags.unpaid,
});

console.log(
  `Created reservation for "${tour.title}": ${attendees.map((m) => m.name).join(', ')} (booked by ${bookedByUser.name}, paid: ${reservation.paid}).`,
);

await mongoose.disconnect();
