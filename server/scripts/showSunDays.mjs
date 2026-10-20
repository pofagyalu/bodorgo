// Shows a tour's stored sun moments (Az idő járása) in Budapest time.
// Usage: node scripts/showSunDays.mjs <tour order>
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';

await mongoose.connect(config.db.uri);
const tour = await Tour.findOne({ order: Number(process.argv[2]) })
  .select('title startDate location sunDays')
  .lean();
console.log(tour.title, tour.location?.coordinates, tour.location?.country, tour.startDate);
for (const day of tour.sunDays) {
  const times = Object.entries(day)
    .filter(([, v]) => v instanceof Date)
    .map(
      ([k, v]) =>
        `${k} ${v.toLocaleTimeString('hu-HU', { timeZone: 'Europe/Budapest', timeStyle: 'short' })}`,
    );
  console.log(`day ${day.day}: ${times.join(' | ')}`);
}
await mongoose.disconnect();
