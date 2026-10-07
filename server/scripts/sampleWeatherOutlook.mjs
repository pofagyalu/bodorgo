// Try-out helper: gives a tour a made-up weather outlook ("Milyen időnk
// lesz?"), to see how the panel, the tour card's pill and the Programfüzet
// block look before a real forecast covers a whole tour. For the local
// (dev) database only - never run it against live.
//
//   node scripts/sampleWeatherOutlook.mjs <tourId|order|slug> [mood]
//   node scripts/sampleWeatherOutlook.mjs <tourId|order|slug> --remove
//
// mood: perfect | great | mixed (default) | gloomy | rough
//
// A tour that already started gets the outlook as "what was promised"
// (frozen). A tour still ahead gets made-up forecast days instead, and the
// app builds the outlook from them itself - they are dated far ahead so no
// real forecast replaces them until --remove.

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import { buildWeatherOutlook } from '../src/utils/weatherOutlook.js';
import { OUTLOOK_SETTINGS } from '../src/utils/weatherOutlookSettings.js';

// One made-up day per mood, bent on the second day so there is a best and
// a worst one. `temp`: the daytime temperature, in degrees from the bottom
// of the month's comfortable range - a tour is judged against its season.
const MOODS = {
  perfect: { day: { condition: 'clear', temp: 3, windSpeedKmh: 8, rainChance: 0 }, twist: {} },
  great: {
    day: { condition: 'partly-cloudy', temp: -3, windSpeedKmh: 14, rainChance: 10 },
    twist: { condition: 'cloudy' },
  },
  mixed: {
    day: { condition: 'cloudy', temp: -2, windSpeedKmh: 22, rainChance: 30 },
    twist: { condition: 'rain', temp: -4, rainChance: 70, windSpeedKmh: 38 },
  },
  gloomy: {
    day: { condition: 'fog', temp: -6, windSpeedKmh: 12, rainChance: 40 },
    twist: { condition: 'rain', temp: -7, rainChance: 80 },
  },
  rough: {
    day: { condition: 'rain', temp: -10, windSpeedKmh: 42, rainChance: 90 },
    twist: { condition: 'thunderstorm', temp: -11, rainChance: 100 },
  },
};

const [, , identifier, option = 'mixed'] = process.argv;
if (!identifier || (option !== '--remove' && !MOODS[option])) {
  console.error(
    'Usage: node scripts/sampleWeatherOutlook.mjs <tourId|order|slug> [perfect|great|mixed|gloomy|rough|--remove]',
  );
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  console.error('This is a try-out helper for the dev database - not run in production.');
  process.exit(1);
}

await mongoose.connect(config.db.uri);

let tour;
if (mongoose.isValidObjectId(identifier)) tour = await Tour.findById(identifier);
else if (/^\d+$/.test(identifier)) tour = await Tour.findOne({ order: Number(identifier) });
else tour = await Tour.findOne({ slug: identifier });

if (!tour) {
  console.error(`No tour found matching "${identifier}".`);
  await mongoose.disconnect();
  process.exit(1);
}

const today = new Date();
today.setHours(0, 0, 0, 0);
const start = new Date(tour.startDate);
start.setHours(0, 0, 0, 0);
const started = start <= today;

if (option === '--remove') {
  tour.weatherOutlook = undefined;
  // A coming tour's made-up days go too; the real forecast returns at the
  // next visit. A past tour's recorded weather was never touched.
  if (!started) tour.dailyWeather = [];
  await tour.save();
  console.log(`Removed the sample outlook of "${tour.title}" (order ${tour.order}).`);
  await mongoose.disconnect();
  process.exit(0);
}

const [comfortLow] = OUTLOOK_SETTINGS.comfortByMonth[start.getMonth()];
const days = [];
for (let day = 1; day <= tour.duration; day++) {
  const { temp, ...made } = { ...MOODS[option].day, ...(day === 2 ? MOODS[option].twist : {}) };
  days.push({
    day,
    ...made,
    tempDayC: comfortLow + temp,
    tempNightC: comfortLow + temp - 9,
    isFinal: false,
  });
}

if (started) {
  // As it would have stood two days before the start.
  const then = new Date(start);
  then.setDate(then.getDate() - 2);
  const outlook = buildWeatherOutlook(
    { order: tour.order, startDate: tour.startDate, duration: tour.duration, dailyWeather: days },
    then,
  );
  tour.weatherOutlook = { ...outlook, frozen: true, updatedAt: new Date() };
} else {
  const farAhead = new Date('2099-01-01');
  tour.dailyWeather = days.map((d) => ({ ...d, fetchedAt: farAhead }));
}
await tour.save();

console.log(
  started
    ? `"${tour.title}" (order ${tour.order}) now has a made-up outlook (${tour.weatherOutlook.tier}, ${tour.weatherOutlook.score}), frozen as "Ezt ígérték".`
    : `"${tour.title}" (order ${tour.order}) now has made-up ${option} forecast days; its outlook appears at the next visit.`,
);
await mongoose.disconnect();
