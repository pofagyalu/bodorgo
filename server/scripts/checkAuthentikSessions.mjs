// Read only: can the app's Authentik service-account token see a user's
// Authentik login sessions (core/authenticated_sessions)? Groundwork for
// "log out everywhere". Usage: node scripts/checkAuthentikSessions.mjs <e-mail | all>
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import { getOidcSettings } from '../src/utils/oidcSettings.js';

const email = process.argv[2];
if (!email) {
  console.log('Usage: node scripts/checkAuthentikSessions.mjs <e-mail>');
  process.exit(1);
}

await mongoose.connect(config.db.uri);
const settings = await getOidcSettings();
console.log(
  'Authentik:',
  settings.serverUrl,
  '| token from:',
  settings.source,
  '| token set:',
  !!settings.apiToken,
);

async function get(path) {
  const res = await fetch(`${settings.serverUrl}/api/v3${path}`, {
    headers: { Authorization: `Bearer ${settings.apiToken}` },
  });
  const text = await res.text();
  console.log(`GET ${path} -> ${res.status}`);
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text.slice(0, 300) };
  }
}

const me = await get('/core/users/me/');
console.log('Token belongs to:', me.body?.user?.username ?? me.body);

const users = await get(`/core/users/?email=${encodeURIComponent(email)}`);
const user = users.body?.results?.[0];
console.log('User lookup:', user ? `${user.username} (pk ${user.pk})` : users.body);

// "all" instead of an e-mail: every session the token may see, unfiltered.
const sessions = await get(
  email === 'all'
    ? '/core/authenticated_sessions/?page_size=100'
    : `/core/authenticated_sessions/?user__username=${encodeURIComponent(user?.username ?? email)}`,
);
if (sessions.status === 200) {
  console.log('Sessions found:', sessions.body.results?.length);
  for (const s of sessions.body.results ?? []) {
    console.log(
      ' -',
      s.uuid,
      '| user:',
      JSON.stringify(s.user),
      '| current:',
      s.current,
      '| last used:',
      s.last_used,
      '| expires:',
      s.expires,
      '| ua:',
      s.user_agent?.user_agent?.family,
      s.user_agent?.os?.family,
      '| ip:',
      s.last_ip,
    );
  }
} else {
  console.log(sessions.body);
}
await mongoose.disconnect();
