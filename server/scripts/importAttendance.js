// Temporary CLI utility to record a whole tour's historical attendance in
// one pass - creating any families it mentions for the first time, reusing
// them on later runs, and (with --replace) wiping out whatever reservations
// already exist for the tour first. Built for bulk-uploading old tours
// where several never-before-seen families need to be entered at once,
// which createFamily.js + addFamilyMember.js + create-reservation.js would
// otherwise take several separate commands per family to do.
//
// Usage:
//   node scripts/importAttendance.js <tourId|order|slug> <path-to-json> [--replace]
//
// --replace deletes every existing reservation for this tour before
// importing - use it when the tour already has reservations you know are
// wrong/incomplete and want to start over. Without it, people already
// registered are simply skipped (safe to re-run).
//
// attendance.json is an array of family blocks. Two shapes:
//
// 1) Brand new family - give "members" (its full roster, not just who
//    attended this specific tour) and this creates them:
//   {
//     "members": [
//       { "name": "Nagy Zoltán", "email": "zoltan@example.com" },
//       { "name": "Nagy Anna", "email": "anna@example.com" },
//       { "name": "Nagy Bálint" }
//     ],
//     "attendees": ["Nagy Zoltán", "Nagy Anna", "Nagy Bálint"],
//     "paidBy": "Nagy Zoltán",
//     "paid": true
//   }
//
// 2) Family already exists (from a previous import, or createFamily.js) -
//    give "anchor" (any member's email, or name if they have none) instead
//    of "members":
//   {
//     "anchor": "peter@kovacs.hu",
//     "attendees": ["Kovács Péter", "Kovács Kata"]
//   }
//
// "attendees" is the subset of the family who actually attended THIS tour -
// a kid born after this tour took place just isn't listed here, even
// though they're part of the family (e.g. for later tours). "paidBy"
// defaults to the first attendee, "paid" defaults to true.

import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import User from '../src/models/userModel.js';
import Reservation from '../src/models/reservationModel.js';

const rawArgs = process.argv.slice(2);
const positional = [];
let replace = false;
for (const arg of rawArgs) {
  if (arg === '--replace') replace = true;
  else positional.push(arg);
}

const [tourIdentifier, filePath] = positional;

if (!tourIdentifier || !filePath) {
  console.error(
    'Usage: node scripts/importAttendance.js <tourId|order|slug> <path-to-json> [--replace]',
  );
  process.exit(1);
}

const blocks = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
if (!Array.isArray(blocks) || blocks.length === 0) {
  console.error('attendance.json must be a non-empty array of family blocks.');
  process.exit(1);
}

async function findByAnchor(anchor) {
  return anchor.includes('@')
    ? User.findOne({ email: anchor.toLowerCase() })
    : User.findOne({ name: anchor });
}

// Resolves a "members" block to a shared familyId, creating whichever
// members don't already exist and reusing whichever do (matched by email,
// else by exact name) - so re-running the same file, or later adding this
// family's next tour, never creates duplicate people.
async function ensureFamily(memberDefs) {
  const matches = [];
  for (const def of memberDefs) {
    // Try email first (the more authoritative identifier), but a person
    // created before family/email tracking existed (e.g. by the old
    // create-reservation.js, matched by exact name only) has no email yet -
    // falling back to a name match reuses that same historical record and
    // backfills the email onto it, instead of silently creating a
    // disconnected duplicate that "attended" this tour under a different
    // identity than their other tours.
    const existing = (def.email && (await findByAnchor(def.email))) || (await findByAnchor(def.name));
    matches.push({ def, existing });
  }

  let familyId = null;
  for (const { def, existing } of matches) {
    if (existing?.familyId) {
      if (familyId && !existing.familyId.equals(familyId)) {
        throw new Error(
          `"${def.name}" already belongs to a different family than another member in this block.`,
        );
      }
      familyId = existing.familyId;
    }
  }
  if (!familyId) familyId = new mongoose.Types.ObjectId();

  // Returns { name, user } pairs rather than bare User docs - name is
  // always the JSON's own def.name, which matters when an email resolves
  // to an existing account whose stored .name differs (e.g. an admin's
  // account might be named "Nagy Gazda" today but attended a 2012 tour as
  // "Nagy Zoltán"). attendees/paidBy below match against this def.name, not
  // the account's current display name - matching against the account's
  // name instead silently dropped that attendee entirely in one real case.
  const members = [];
  for (const { def, existing } of matches) {
    if (existing) {
      let changed = false;
      if (!existing.familyId) {
        existing.familyId = familyId;
        changed = true;
      }
      // Backfill an email onto a pre-existing name-only record, but never
      // overwrite one that's already set - that would be a real conflict,
      // not a gap to fill. role is deliberately never touched here - it's
      // driven entirely by Authentik on login (see
      // authOidcController.js), not something having an email implies.
      if (def.email && !existing.email) {
        existing.email = def.email.toLowerCase();
        changed = true;
      }
      if (changed) await existing.save();
      members.push({ name: def.name, user: existing });
    } else {
      const created = await User.create({
        name: def.name,
        email: def.email ? def.email.toLowerCase() : undefined,
        familyId,
      });
      members.push({ name: def.name, user: created });
    }
  }
  return members;
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

if (replace) {
  const deleted = await Reservation.deleteMany({ tour: tour._id });
  console.log(`--replace: removed ${deleted.deletedCount} existing reservation(s) for "${tour.title}".`);
}

const alreadyRegisteredIds = new Set(
  (await Reservation.find({ tour: tour._id }).select('attendees.user')).flatMap((r) =>
    r.attendees.map((a) => a.user.toString()),
  ),
);

for (const block of blocks) {
  let familyMembers;
  try {
    if (block.members) {
      familyMembers = await ensureFamily(block.members);
    } else if (block.anchor) {
      const anchorUser = await findByAnchor(block.anchor);
      if (!anchorUser?.familyId) {
        console.error(`Skipping block: no existing family found for anchor "${block.anchor}".`);
        continue;
      }
      const users = await User.find({ familyId: anchorUser.familyId });
      familyMembers = users.map((user) => ({ name: user.name, user }));
    } else {
      console.error('Skipping block: needs either "members" or "anchor".');
      continue;
    }
  } catch (err) {
    console.error(`Skipping block: ${err.message}`);
    continue;
  }

  if (!Array.isArray(block.attendees) || block.attendees.length === 0) {
    console.error('Skipping block: no "attendees" listed.');
    continue;
  }

  const attendees = [];
  for (const name of block.attendees) {
    const match = familyMembers.find((m) => m.name === name);
    if (!match) {
      console.error(`  "${name}" is not part of this family - skipping this name.`);
      continue;
    }
    if (alreadyRegisteredIds.has(match.user._id.toString())) {
      console.log(`  ${name} already registered for this tour - skipping.`);
      continue;
    }
    attendees.push(match);
  }

  if (attendees.length === 0) {
    console.log('  Nothing new to register for this family.');
    continue;
  }

  const paidByName = block.paidBy || block.attendees[0];
  const paidByMatch = familyMembers.find((m) => m.name === paidByName) || attendees[0];

  const reservation = await Reservation.create({
    tour: tour._id,
    bookedBy: paidByMatch.user._id,
    attendees: attendees.map(({ name, user }) => ({ user: user._id, name })),
    paid: block.paid !== undefined ? block.paid : true,
  });

  attendees.forEach(({ user }) => alreadyRegisteredIds.add(user._id.toString()));

  console.log(
    `✓ ${attendees.map((a) => a.name).join(', ')} (paid by ${paidByMatch.name}, paid: ${reservation.paid})`,
  );
}

await mongoose.disconnect();
