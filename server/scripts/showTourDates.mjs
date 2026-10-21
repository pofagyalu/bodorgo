// Read-only: a tour's dates, place and stored sun days - and whether
// computeSunDays / tourCourseWindow work on it.
// Usage: node scripts/showTourDates.mjs <slug> [--dev]
import fs from 'fs';
import mongoose from 'mongoose';
import { computeSunDays } from '../src/utils/sunDays.js';
import { tourCourseWindow } from '../src/futokor/tourWindow.js';
const envFile = process.argv.includes('--dev') ? '.env' : 'S:/bodorgo/.env';
const env = Object.fromEntries(
  fs
    .readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
);
const slug = process.argv.slice(2).find((a) => !a.startsWith('--'));
await mongoose.connect(env.DB_URI);
const tour = await mongoose.connection.db.collection('tours').findOne({ slug });
console.log(envFile, slug, tour?.title);
console.log('startDate', tour?.startDate, 'duration', tour?.duration);
console.log('location', JSON.stringify(tour?.location));
console.log('stored sunDays', JSON.stringify(tour?.sunDays)?.slice(0, 600));
try {
  const sun = computeSunDays(tour);
  console.log(
    'computed sunDays: invalid moments',
    sun.flatMap((d) =>
      Object.entries(d)
        .filter(([, v]) => v instanceof Date && isNaN(v))
        .map(([k]) => `day ${d.day} ${k}`),
    ),
  );
} catch (e) {
  console.log('computeSunDays threw', e.message);
}
try {
  console.log('course window', tourCourseWindow(tour));
} catch (e) {
  console.log('tourCourseWindow threw', e.message);
}
await mongoose.disconnect();
