// Verifies the restricted-image feature (tourModel.js's images.restricted,
// tourImageController.js's canViewRestrictedImages/loadTourImage) against
// real data: tour order 2 ("Tamási szarvasnéző", 62 synced photos, 5 real
// reservations). Temporarily restricts one real photo, checks admin /
// actual-attendee / non-attendee access on both the single-image route and
// the list endpoint, then always un-restricts it again in a `finally` -
// this touches real production data, not a throwaway test tour.
//
// Usage:
//   node scripts/testRestrictedImages.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import User from '../src/models/userModel.js';
import Reservation from '../src/models/reservationModel.js';
import {
  getTourImages,
  getTourImage,
  setImageRestricted,
} from '../src/controllers/tourImageController.js';

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    sentFile: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    sendFile(p) {
      this.sentFile = p;
    },
  };
}

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

await mongoose.connect(config.db.testUri);

const tour = await Tour.findOne({ order: 2 }).select('+images');
if (!tour || tour.images.length === 0) {
  console.error('Tour order 2 has no synced images - run scripts/syncTourImages.js 2 first.');
  process.exit(1);
}
const tourId = tour._id.toString();
const targetFilename = tour.images[0].filename;

const admin = await User.findOne({ role: 'admin' });
const reservation = await Reservation.findOne({ tour: tour._id }).populate('attendees.user');
if (!admin || !reservation) {
  console.error('Need at least one admin user and one real reservation for tour order 2.');
  process.exit(1);
}
const attendee = reservation.attendees[0].user;

const nonAttendee = await User.create({ name: 'ZZ Restricted Test Non-Attendee', role: 'guest' });

try {
  const setRes = fakeRes();
  await setImageRestricted(
    { params: { tourId, filename: targetFilename }, body: { restricted: true } },
    setRes,
  );
  check('setImageRestricted marks the photo restricted', setRes.body?.data?.image?.restricted === true);

  const adminRes = fakeRes();
  await getTourImage({ params: { tourId, filename: targetFilename }, user: admin }, adminRes);
  check('admin can view a restricted photo', adminRes.sentFile?.endsWith(targetFilename));

  const attendeeRes = fakeRes();
  await getTourImage({ params: { tourId, filename: targetFilename }, user: attendee }, attendeeRes);
  check('an actual attendee can view a restricted photo', attendeeRes.sentFile?.endsWith(targetFilename));

  let nonAttendeeError = null;
  try {
    await getTourImage({ params: { tourId, filename: targetFilename }, user: nonAttendee }, fakeRes());
  } catch (err) {
    nonAttendeeError = err;
  }
  check(
    'a non-attendee is rejected, same error as an unknown filename',
    !!nonAttendeeError && /Nincs ilyen fénykép/.test(nonAttendeeError.message),
  );

  const adminList = fakeRes();
  await getTourImages({ params: { tourId }, user: admin }, adminList);
  check(
    'admin sees the restricted photo in the list',
    adminList.body?.data?.images?.some((i) => i.filename === targetFilename),
  );

  const nonAttendeeList = fakeRes();
  await getTourImages({ params: { tourId }, user: nonAttendee }, nonAttendeeList);
  check(
    "non-attendee's list omits the restricted photo entirely",
    !nonAttendeeList.body?.data?.images?.some((i) => i.filename === targetFilename),
  );
  check(
    "non-attendee's list still has every other photo",
    nonAttendeeList.body?.data?.images?.length === tour.images.length - 1,
  );
} finally {
  // Always restore, regardless of pass/fail - this is real production data.
  await setImageRestricted({ params: { tourId, filename: targetFilename }, body: { restricted: false } }, fakeRes());
  await User.deleteOne({ _id: nonAttendee._id });
  console.log('\nRestored the photo to unrestricted and cleaned up the test user.');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');

await mongoose.disconnect();
