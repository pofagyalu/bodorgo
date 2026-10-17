// Read-only: every tour's address fields, as stored.
// Usage: node scripts/tourAddresses.mjs
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';

await mongoose.connect(config.db.uri);
for (const t of await Tour.find().sort('order').lean()) {
  console.log(
    t.order,
    '|',
    t.title,
    '|',
    JSON.stringify(t.startLocation ?? t.location ?? null),
    '|',
    t.address ?? '',
  );
}
await mongoose.disconnect();
