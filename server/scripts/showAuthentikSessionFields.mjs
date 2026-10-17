// Read only: every field Authentik returns for one of this user's sessions
// (values shortened), to see what could tie it to the ID token's "sid".
// Usage: node scripts/showAuthentikSessionFields.mjs <authentik username>
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import { getOidcSettings } from '../src/utils/oidcSettings.js';

await mongoose.connect(config.db.uri);
const s = await getOidcSettings();
const res = await fetch(
  `${s.serverUrl}/api/v3/core/authenticated_sessions/?user__username=${encodeURIComponent(process.argv[2])}&page_size=1`,
  { headers: { Authorization: `Bearer ${s.apiToken}` } },
);
const first = (await res.json()).results?.[0] ?? {};
for (const [k, v] of Object.entries(first)) console.log(k, '=', JSON.stringify(v).slice(0, 90));
await mongoose.disconnect();
