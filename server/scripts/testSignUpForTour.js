// Verifies reservationController.js's signUpForTour() - specifically the
// role-based authorization added when self-only sign-up became "pick who
// to register" (guest: only self; member: self + family; admin: anyone),
// plus the duplicate-attendee and capacity checks that replaced the old
// "one reservation per booking user" rule (removed since a member/admin
// can legitimately submit more than once to add different people over
// time). Calls the real exported controller function directly with a
// fake req/res rather than going over HTTP - AppError is thrown, not
// passed to next(), so a normal try/catch around the call is enough.
// Creates and cleans up its own throwaway tours/users - safe to re-run.
//
// Usage:
//   node scripts/testSignUpForTour.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import User from '../src/models/userModel.js';
import Reservation from '../src/models/reservationModel.js';
import { signUpForTour } from '../src/controllers/reservationController.js';

const ORDER_MAIN = 9991;
const ORDER_CAPACITY = 9992;

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

async function call(user, tourId, attendeeIds) {
  const req = { params: { tourId: tourId.toString() }, body: { attendeeIds }, user };
  const res = fakeRes();
  await signUpForTour(req, res);
  return res;
}

await mongoose.connect(config.db.testUri);
await Tour.deleteMany({ order: { $in: [ORDER_MAIN, ORDER_CAPACITY] } });
await User.deleteMany({ name: { $regex: '^ZZ SignUp Test' } });

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

const baseTourFields = {
  startDate: new Date('2027-09-01'),
  duration: 1,
  price: 100,
  description: 'temp',
  imageCover: 'tour-1-cover.webp',
};

const tour = await Tour.create({ ...baseTourFields, order: ORDER_MAIN, title: 'ZZ SignUp Test Tour', maxCapacity: 10 });
const capacityTour = await Tour.create({
  ...baseTourFields,
  order: ORDER_CAPACITY,
  title: 'ZZ SignUp Test Capacity Tour',
  maxCapacity: 1,
});

const familyId = new mongoose.Types.ObjectId();
const otherFamilyId = new mongoose.Types.ObjectId();

const memberUser = await User.create({ name: 'ZZ SignUp Test Member', role: 'member', familyId });
const familyMember = await User.create({ name: 'ZZ SignUp Test Family Member', role: 'guest', familyId });
const outsider = await User.create({ name: 'ZZ SignUp Test Outsider', role: 'member', familyId: otherFamilyId });
const guestUser = await User.create({ name: 'ZZ SignUp Test Guest', role: 'guest' });
const adminUser = await User.create({ name: 'ZZ SignUp Test Admin', role: 'admin' });

const guestSelf = await call(guestUser, tour._id, [guestUser._id.toString()]);
check('guest can register themselves', guestSelf.statusCode === 201);

let guestOtherError = null;
try {
  await call(guestUser, tour._id, [outsider._id.toString()]);
} catch (err) {
  guestOtherError = err;
}
check(
  'guest cannot register someone else',
  !!guestOtherError && /csak saját magadat/i.test(guestOtherError.message),
);

const memberSelfAndFamily = await call(memberUser, tour._id, [
  memberUser._id.toString(),
  familyMember._id.toString(),
]);
check(
  'member can register self + a family member in one go',
  memberSelfAndFamily.statusCode === 201 &&
    memberSelfAndFamily.body.data.reservation.attendees.length === 2,
);
check(
  'bookedBy is populated on the response',
  memberSelfAndFamily.body.data.reservation.bookedBy?.name === memberUser.name,
);

let memberOutsiderError = null;
try {
  await call(memberUser, tour._id, [outsider._id.toString()]);
} catch (err) {
  memberOutsiderError = err;
}
check(
  'member cannot register someone outside their family',
  !!memberOutsiderError && /hozzátartozóidat/i.test(memberOutsiderError.message),
);

const adminForOutsider = await call(adminUser, tour._id, [outsider._id.toString()]);
check('admin can register anyone, including a non-relative', adminForOutsider.statusCode === 201);

let duplicateError = null;
try {
  await call(adminUser, tour._id, [outsider._id.toString()]);
} catch (err) {
  duplicateError = err;
}
check(
  'registering an already-registered attendee again is rejected',
  !!duplicateError && /már jelentkezett/i.test(duplicateError.message),
);

// Separate tiny-capacity tour so this check isn't tangled up with the
// duplicate-detection check above (which fires first if the same person
// is reused).
await call(guestUser, capacityTour._id, [guestUser._id.toString()]);
let capacityError = null;
try {
  await call(adminUser, capacityTour._id, [outsider._id.toString()]);
} catch (err) {
  capacityError = err;
}
check(
  'registering past maxCapacity is rejected',
  !!capacityError && /megtelt/i.test(capacityError.message),
);

await Reservation.deleteMany({ tour: { $in: [tour._id, capacityTour._id] } });
await Tour.deleteMany({ _id: { $in: [tour._id, capacityTour._id] } });
await User.deleteMany({ name: { $regex: '^ZZ SignUp Test' } });
console.log('\nCleaned up test tours/users/reservations.');

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');

await mongoose.disconnect();
