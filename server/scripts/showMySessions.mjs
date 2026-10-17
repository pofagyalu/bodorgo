// Read only: one user's app sessions in this database's `sessions`
// collection - when each expires (so roughly when it was last active), what
// it carries - to see where leftover ones come from.
// Usage: node scripts/showMySessions.mjs <e-mail>
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';

await mongoose.connect(config.db.uri);
const docs = await mongoose.connection.db
  .collection('sessions')
  .find({})
  .sort({ expires: -1 })
  .toArray();
console.log('database:', mongoose.connection.db.databaseName, '| all sessions:', docs.length);
for (const d of docs) {
  const s = typeof d.session === 'string' ? JSON.parse(d.session) : d.session;
  const u = s.user;
  if (u && u.email !== process.argv[2]) continue;
  const lastActive = new Date(d.expires - 90 * 24 * 3600 * 1000).toISOString().slice(0, 16);
  console.log(
    lastActive,
    '|',
    u ? 'user' : 'NO USER',
    '| keys:',
    Object.keys(u ?? s).join(','),
    '| provider:',
    u?.provider ?? '-',
    '| authAt:',
    u?.authAt ? new Date(u.authAt).toISOString().slice(0, 16) : '-',
  );
}
await mongoose.disconnect();
