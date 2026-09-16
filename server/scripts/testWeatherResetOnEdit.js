// Verifies tourModel.js's new pre('save') hook: editing startDate,
// duration, or location.coordinates clears dailyWeather, since cached
// weather (especially once frozen via isFinal - see
// tourController.js's refreshTourWeather) is tied to specific calendar
// dates and a specific location, and nothing was invalidating it on edit
// before this. Real reported bug: several tours quickly created with the
// same placeholder date+location kept showing identical weather even after
// their real per-tour dates were edited in.
//
// Creates and cleans up its own throwaway tour (order 9993) - safe to
// re-run.
//
// Usage:
//   node scripts/testWeatherResetOnEdit.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';

const TEST_ORDER = 9993;

await mongoose.connect(config.db.testUri);
await Tour.deleteOne({ order: TEST_ORDER }); // clean slate if a previous run left one behind

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

const fakeWeatherEntry = () => ({
  day: 1,
  condition: 'clear',
  tempDayC: 20,
  tempNightC: 10,
  windSpeedKmh: 5,
  isFinal: true,
  fetchedAt: new Date(),
});

const tour = await Tour.create({
  order: TEST_ORDER,
  title: 'ZZ Test Weather Reset Tour',
  location: { coordinates: [19.5, 47.16], description: 'Teszt hely', address: 'Teszt cím' },
  startDate: new Date('2027-09-01'),
  duration: 2,
  maxCapacity: 10,
  price: 500,
  description: 'temp',
  imageCover: 'tour-1-cover.webp',
});

// Simulate "weather was already fetched/frozen" by setting it directly and
// saving with nothing else changed - the hook must NOT fire here (this
// save doesn't touch startDate/duration/coordinates).
tour.dailyWeather = [fakeWeatherEntry()];
await tour.save();
check('cached weather survives a save that only touches dailyWeather itself', tour.dailyWeather.length === 1);

// Editing an unrelated field must NOT clear it either - guards against the
// hook being too broad.
tour.title = 'ZZ Test Weather Reset Tour (renamed)';
await tour.save();
check('cached weather survives an edit to an unrelated field (title)', tour.dailyWeather.length === 1);

// The actual fix: editing startDate must clear it.
tour.startDate = new Date('2027-10-15');
await tour.save();
check('editing startDate clears cached weather', tour.dailyWeather.length === 0);

// Re-seed, then verify duration alone also clears it.
tour.dailyWeather = [fakeWeatherEntry()];
await tour.save();
tour.duration = 3;
await tour.save();
check('editing duration clears cached weather', tour.dailyWeather.length === 0);

// Re-seed, then verify location.coordinates alone also clears it - weather
// is fetched for a specific lat/lng, not just a specific date.
tour.dailyWeather = [fakeWeatherEntry()];
await tour.save();
tour.location.coordinates = [20.1, 46.9];
await tour.save();
check('editing location.coordinates clears cached weather', tour.dailyWeather.length === 0);

await Tour.deleteOne({ _id: tour._id });
console.log('\nCleaned up test tour.');

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');

await mongoose.disconnect();
