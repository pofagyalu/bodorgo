// Read only: which claims Authentik puts in the ID token kept in the app's
// newest sessions (e.g. whether there is a "sid" that names the Authentik
// session). Prints claim names and the sid, never the token itself.
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';

await mongoose.connect(config.db.uri);
const sessions = await mongoose.connection.db
  .collection('sessions')
  .find({})
  .sort({ expires: -1 })
  .limit(5)
  .toArray();
for (const s of sessions) {
  const data = typeof s.session === 'string' ? JSON.parse(s.session) : s.session;
  const token = data.user?.id_token;
  if (!token) continue;
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  console.log(
    data.user.email,
    '| claims:',
    Object.keys(claims).join(','),
    '| sid:',
    claims.sid ?? '-',
  );
}
await mongoose.disconnect();
