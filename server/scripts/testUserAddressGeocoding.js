// Verifies the user-address feature end to end against the REAL
// OpenRouteService geocoding API (a real key is already configured -
// see .env's OPENROUTESERVICE_API_KEY): saving a real address actually
// geocodes it, updateMe/updateUser correctly report addressResolved,
// clearing the address clears the stale location too, and existing
// unset semantics (familyId/birthday/gender via empty string) still
// work after the findByIdAndUpdate -> load+save refactor.
//
// Also empirically answers a real question: does a Hungarian exonym for
// a Transylvanian town (e.g. "Marosvásárhely" for Târgu Mureș) actually
// resolve via this geocoder? This hits the real API to find out rather
// than guessing.
//
// Creates its own throwaway user (order-adjacent id, not a real family
// member) - never touches real data. Safe to re-run, but each run makes
// a handful of real geocoding API calls.
//
// Usage:
//   node scripts/testUserAddressGeocoding.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import User from '../src/models/userModel.js';
import { updateMe, updateUser } from '../src/controllers/userController.js';
import { geocodeAddress } from '../src/utils/distance.js';

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

await mongoose.connect(config.db.testUri);

const testUserId = new mongoose.Types.ObjectId();

try {
  const user = await User.create({
    _id: testUserId,
    sub: `test-${testUserId}`,
    name: 'ZZ Teszt Elek',
    role: 'member',
  });

  // --- A real Hungarian address geocodes successfully via updateMe ---
  {
    const req = {
      user,
      body: { address: { zipCode: '2016', city: 'Leányfalu', street: 'Móricz Zsigmond utca 1.', country: 'Magyarország' } },
    };
    const res = fakeRes();
    await updateMe(req, res);

    check('updateMe responds 200 for a real address', res.statusCode === null || res.statusCode === 200);
    check('addressResolved is true for a real, geocodable address', res.body.data.addressResolved === true);
    check('location.lat/lng were actually set', typeof res.body.data.user.location?.lat === 'number' && typeof res.body.data.user.location?.lng === 'number');
    // Leányfalu is ~25km north of Budapest on the Danube bend - a loose
    // sanity bound, not an exact-match assertion (geocoders return the
    // centroid of whatever matched, not this specific street number).
    check(
      "the resolved point is roughly where Leányfalu actually is (near Budapest, not e.g. on another continent)",
      Math.abs(res.body.data.user.location.lat - 47.65) < 0.5 && Math.abs(res.body.data.user.location.lng - 19.1) < 0.5,
    );
  }

  // --- Clearing the address clears the stale location too ---
  {
    const req = { user: await User.findById(testUserId), body: { address: { zipCode: '', city: '', street: '', country: '' } } };
    const res = fakeRes();
    await updateMe(req, res);
    check('addressResolved is null once the address is cleared (nothing to resolve)', res.body.data.addressResolved === null);
    // Mongoose leaves `location` as a bare {} rather than fully removing
    // the key (it's a plain nested path, not a real subdocument) - what
    // actually matters is that both leaf coordinates are gone, since
    // that's the only thing the distance-from-user-location logic checks
    // before falling back to Budapest.
    check('location.lat/lng were both cleared along with the address', res.body.data.user.location?.lat == null && res.body.data.user.location?.lng == null);
  }

  // --- An admin can set/fix a dependent's address too (updateUser) ---
  {
    const admin = { role: 'admin' };
    const req = { params: { id: String(testUserId) }, body: { address: { city: 'Debrecen', country: 'Magyarország' } } };
    const res = fakeRes();
    await updateUser(req, res);
    check('an admin setting a real city via updateUser also resolves it', res.body.data.addressResolved === true);
  }

  // --- Existing unset semantics (birthday/gender/familyId via empty string) still work after the load+save refactor ---
  {
    await User.findByIdAndUpdate(testUserId, { birthday: new Date('1990-01-01'), gender: 'férfi' });
    const req = { params: { id: String(testUserId) }, body: { birthday: '', gender: '' } };
    const res = fakeRes();
    await updateUser(req, res);
    check('birthday was unset via empty string, not left as-is or set to null-that-still-passes', res.body.data.user.birthday === undefined);
    check('gender was unset via empty string', res.body.data.user.gender === undefined);
  }

  // --- Empirical answer: does the Hungarian exonym for a Transylvanian town resolve? ---
  {
    const result = await geocodeAddress('Marosvásárhely, Románia');
    if (result) {
      console.log(`ℹ "Marosvásárhely, Románia" DID resolve via this geocoder: lat=${result.lat}, lng=${result.lng}`);
    } else {
      console.log('ℹ "Marosvásárhely, Románia" did NOT resolve via this geocoder (no match) - the official/Romanian name should be tried instead.');
    }
    // Informational only, not a pass/fail check - this documents actual
    // real-world behavior rather than asserting a guess about it.
  }
} finally {
  await User.deleteOne({ _id: testUserId });
  console.log('\nCleaned up the throwaway test user.');
}

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');

await mongoose.disconnect();
process.exit(0);
