// Ends one Authentik login session by its uuid (as checkAuthentikSessions.mjs
// lists them), with the app's service-account token. That device then has to
// log in to Authentik again. Usage: node scripts/deleteAuthentikSession.mjs <uuid>
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import { getOidcSettings } from '../src/utils/oidcSettings.js';

const uuid = process.argv[2];
if (!/^[0-9a-f-]{36}$/i.test(uuid ?? '')) {
  console.log('Usage: node scripts/deleteAuthentikSession.mjs <uuid>');
  process.exit(1);
}

await mongoose.connect(config.db.uri);
const settings = await getOidcSettings();
const res = await fetch(`${settings.serverUrl}/api/v3/core/authenticated_sessions/${uuid}/`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${settings.apiToken}` },
});
console.log(
  `DELETE ${uuid} -> ${res.status}`,
  res.status === 204 ? '' : (await res.text()).slice(0, 300),
);
await mongoose.disconnect();
