// Shows, for the newest sessions, when the provider said the person last
// identified themselves (authAt, see src/auth/freshLogin.js). Read only.
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';

await mongoose.connect(config.db.uri);
const sessions = await mongoose.connection.db
  .collection('sessions')
  .find({})
  .sort({ expires: -1 })
  .limit(3)
  .toArray();
for (const s of sessions) {
  const data = typeof s.session === 'string' ? JSON.parse(s.session) : s.session;
  const u = data.user ?? {};
  const age = u.authAt ? Math.round((Date.now() - u.authAt) / 1000) : null;
  console.log(u.email, '| authAt:', u.authAt, '| seconds ago:', age, '| expires:', s.expires);
}
await mongoose.disconnect();
