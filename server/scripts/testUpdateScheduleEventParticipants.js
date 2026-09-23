// Verifies updateScheduleEventParticipants (see tourController.js) - the
// real reported case: a family cherry-picks which of their own members
// join an optional event (only the 2 kids for the kids' breakfast, only
// the 2 adults for the adults' one), never affecting another family's
// own opt-ins on the same event, while an admin can set anyone actually
// attending.
//
// Creates its own throwaway tour + two unrelated families (order 9978) -
// never touches real data. Safe to re-run.
//
// Usage:
//   node scripts/testUpdateScheduleEventParticipants.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import Reservation from '../src/models/reservationModel.js';
import User from '../src/models/userModel.js';
import { updateScheduleEventParticipants } from '../src/controllers/tourController.js';

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

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
    },
  };
}

const TEST_ORDER = 9978;

await mongoose.connect(config.db.testUri);

const leftover = await Tour.findOne({ order: TEST_ORDER });
if (leftover) {
  await Reservation.deleteMany({ tour: leftover._id });
  await Tour.deleteOne({ _id: leftover._id });
}

const familyAId = new mongoose.Types.ObjectId();
const dadId = new mongoose.Types.ObjectId();
const momId = new mongoose.Types.ObjectId();
const kid1Id = new mongoose.Types.ObjectId();
const kid2Id = new mongoose.Types.ObjectId();
const familyBId = new mongoose.Types.ObjectId();
const otherParentId = new mongoose.Types.ObjectId();
const adminId = new mongoose.Types.ObjectId();

await User.create([
  { _id: dadId, sub: `test-${dadId}`, name: 'Nagy Zoltán', role: 'member', familyId: familyAId },
  { _id: momId, sub: `test-${momId}`, name: 'Nagy Ilona', role: 'member', familyId: familyAId },
  { _id: kid1Id, sub: `test-${kid1Id}`, name: 'Nagy Kata', role: 'guest', familyId: familyAId },
  { _id: kid2Id, sub: `test-${kid2Id}`, name: 'Nagy Bence', role: 'guest', familyId: familyAId },
  { _id: otherParentId, sub: `test-${otherParentId}`, name: 'Kis Anna', role: 'member', familyId: familyBId },
  { _id: adminId, sub: `test-${adminId}`, name: 'Admin', role: 'admin' },
]);

const tour = await Tour.create({
  order: TEST_ORDER,
  title: 'ZZ Test Tour (schedule participants)',
  location: { description: 'Teszt', address: 'Teszt utca 1.', coordinates: [19, 47] },
  startDate: new Date('2030-06-01'),
  duration: 3,
  maxCapacity: 10,
  summary: 'Teszt',
  description: 'Teszt tábor az esemény-jelentkezés teszteléséhez.',
  imageCover: `tour-${TEST_ORDER}-cover.jpg`,
  schedule: [{ day: 1, time: '08:00', description: 'Reggeli gyerekeknek', isOptional: true, extraCost: 1500, participants: [] }],
});

await Reservation.create({
  tour: tour._id,
  bookedBy: dadId,
  attendees: [
    { user: dadId, name: 'Nagy Zoltán', nights: 2 },
    { user: momId, name: 'Nagy Ilona', nights: 2 },
    { user: kid1Id, name: 'Nagy Kata', nights: 2 },
    { user: kid2Id, name: 'Nagy Bence', nights: 2 },
  ],
});
await Reservation.create({
  tour: tour._id,
  bookedBy: otherParentId,
  attendees: [{ user: otherParentId, name: 'Kis Anna', nights: 2 }],
});

async function eventNow() {
  const t = await Tour.findById(tour._id);
  return t.schedule.id(t.schedule[0]._id);
}

try {
  const eventId = String((await eventNow())._id);

  // --- Dad picks only the two kids for the kids' breakfast, not himself or Mom ---
  {
    const req = { params: { tourId: String(tour._id), eventId }, body: { userIds: [String(kid1Id), String(kid2Id)] }, user: { _id: dadId, role: 'member', familyId: familyAId } };
    const res = fakeRes();
    await updateScheduleEventParticipants(req, res);

    check('responds 200', res.statusCode === 200);
    const names = res.body.data.participants.map((p) => p.name).sort();
    check('only the two kids are participants, not Dad or Mom', names.join(',') === 'Nagy Bence,Nagy Kata');
  }

  // --- A different family (Kis Anna) opts herself in - must NOT wipe out family A's kids ---
  {
    const req = { params: { tourId: String(tour._id), eventId }, body: { userIds: [String(otherParentId)] }, user: { _id: otherParentId, role: 'member', familyId: familyBId } };
    const res = fakeRes();
    await updateScheduleEventParticipants(req, res);

    const names = res.body.data.participants.map((p) => p.name).sort();
    check(
      "Kis Anna joining herself doesn't remove family A's earlier picks (both kids still there, plus her)",
      names.join(',') === 'Kis Anna,Nagy Bence,Nagy Kata',
    );
  }

  // --- Dad changes his mind: now picks himself and Mom too (adults), on TOP of what's already his family's ---
  {
    const req = {
      params: { tourId: String(tour._id), eventId },
      body: { userIds: [String(dadId), String(momId), String(kid1Id), String(kid2Id)] },
      user: { _id: dadId, role: 'member', familyId: familyAId },
    };
    const res = fakeRes();
    await updateScheduleEventParticipants(req, res);

    const names = res.body.data.participants.map((p) => p.name).sort();
    check(
      "Dad's own family now shows all 4, and Kis Anna (a different family) is still untouched",
      names.join(',') === 'Kis Anna,Nagy Bence,Nagy Ilona,Nagy Kata,Nagy Zoltán',
    );
  }

  // --- Dad withdraws his whole family entirely (empty selection) - only his own family's entries are removed ---
  {
    const req = { params: { tourId: String(tour._id), eventId }, body: { userIds: [] }, user: { _id: dadId, role: 'member', familyId: familyAId } };
    const res = fakeRes();
    await updateScheduleEventParticipants(req, res);

    const names = res.body.data.participants.map((p) => p.name).sort();
    check('an empty selection removes exactly his own family, leaving Kis Anna alone', names.join(',') === 'Kis Anna');
  }

  // --- A member can't pick someone outside their own family ---
  {
    const req = {
      params: { tourId: String(tour._id), eventId },
      body: { userIds: [String(otherParentId)] },
      user: { _id: dadId, role: 'member', familyId: familyAId },
    };
    const res = fakeRes();
    let threw = false;
    try {
      await updateScheduleEventParticipants(req, res);
    } catch (err) {
      threw = true;
    }
    check("a member picking someone outside their own family is rejected", threw);
  }

  // --- Admin can pick anyone actually attending, regardless of family ---
  {
    const req = {
      params: { tourId: String(tour._id), eventId },
      body: { userIds: [String(dadId), String(otherParentId)] },
      user: { _id: adminId, role: 'admin' },
    };
    const res = fakeRes();
    await updateScheduleEventParticipants(req, res);
    const names = res.body.data.participants.map((p) => p.name).sort();
    check('admin can freely mix attendees from different families', names.join(',') === 'Kis Anna,Nagy Zoltán');
  }

  // --- A non-optional event can't be opted into at all ---
  {
    const t = await Tour.findById(tour._id);
    t.schedule.push({ day: 1, time: '09:00', description: 'Sima program', isOptional: false });
    await t.save();
    const plainEventId = String(t.schedule[1]._id);

    const req = { params: { tourId: String(tour._id), eventId: plainEventId }, body: { userIds: [String(dadId)] }, user: { _id: dadId, role: 'member', familyId: familyAId } };
    const res = fakeRes();
    let threw = false;
    try {
      await updateScheduleEventParticipants(req, res);
    } catch (err) {
      threw = true;
    }
    check('a non-optional event refuses opt-ins entirely', threw);
  }
} finally {
  await User.deleteMany({ _id: { $in: [dadId, momId, kid1Id, kid2Id, otherParentId, adminId] } });
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
process.exit(0);
