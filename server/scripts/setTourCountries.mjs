// One-off (2026-10-13): tours get their country field (location.country,
// see utils/countries.js). Until now a tour abroad had its country typed at
// the end of its address ("…, SK", "…, Szlovákia"): that ending becomes the
// field and comes off the address; every other tour is HU. A tour that
// already has the field is left alone - re-running is a no-op.
//
// Dry run by default - pass --apply to write.
// Runs against the local .env's database (bodorgo-dev); for production:
//   DB_URI="<live connection string>" node scripts/setTourCountries.mjs --apply
//
// Usage: node scripts/setTourCountries.mjs [--apply]
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import { HOME_COUNTRY, countryAtEndOf } from '../src/utils/countries.js';

const apply = process.argv.includes('--apply');
await mongoose.connect(config.db.uri);
console.log(`database: ${mongoose.connection.name}${apply ? '' : '  [dry run]'}`);

// Straight in the collection: no save hooks (distance, weather) are to run.
const tours = Tour.collection;
let abroad = 0;
let home = 0;
for await (const tour of tours
  .find({ 'location.country': { $exists: false } })
  .sort({ order: 1 })) {
  const address = tour.location?.address ?? '';
  const country = countryAtEndOf(address);
  if (!country) {
    home++;
    if (apply) {
      await tours.updateOne({ _id: tour._id }, { $set: { 'location.country': HOME_COUNTRY } });
    }
    continue;
  }
  abroad++;
  const without = address.slice(0, address.lastIndexOf(',')).trim();
  console.log(
    `${String(tour.order).padStart(3)}. ${tour.title}: ${country}\n       "${address}"\n    -> "${without}"`,
  );
  if (apply) {
    await tours.updateOne(
      { _id: tour._id },
      { $set: { 'location.country': country, 'location.address': without } },
    );
  }
}
console.log(
  `\n${abroad} tour(s) abroad, ${home} in Hungary${apply ? ' - written' : ' - dry run, pass --apply to write'}.`,
);
await mongoose.disconnect();
