import { authentikApi } from './authentikApi.js';
import { getOidcSettings } from './oidcSettings.js';
import { deviceName } from './deviceName.js';
import { isInternalAddress } from './internalAddress.js';

// A person's login sessions at Authentik (Profilom → Bejelentkezések): each
// device that logged in there and may log in to the app again without a
// password. Found by e-mail - the app's own way of telling people apart -
// through the `bodorgo-app` token (its role may view users and view/delete
// authenticated sessions). Which of them is the device asking can't be told:
// Authentik gives no session key to match the ID token's `sid` with.
//
// Each time a browser goes through Authentik's login form again (a new
// login, re-identifying), Authentik makes a new session and moves the
// browser's cookie to it, but keeps the old record until it expires - a
// record no browser can use any more. So the list shows one row per device
// and address, and a login clears that device's older records
// (clearOlderAuthentikSessions).

// Their Authentik username, or null when no account has this e-mail.
async function authentikUsername(settings, email) {
  const found = await authentikApi(settings, `/core/users/?email=${encodeURIComponent(email)}`);
  const user = (found?.results ?? []).find(
    (u) => String(u.email).toLowerCase() === String(email).toLowerCase(),
  );
  return user?.username ?? null;
}

// Every session of theirs as Authentik gives it, newest first; null: no API
// token to ask with.
async function rawSessions(email) {
  const settings = await getOidcSettings();
  if (!settings.serverUrl || !settings.apiToken || !email) return null;
  const username = await authentikUsername(settings, email);
  if (!username) return { settings, sessions: [] };
  const sessions = [];
  let page = 1;
  while (page) {
    const res = await authentikApi(
      settings,
      `/core/authenticated_sessions/?user__username=${encodeURIComponent(username)}&page=${page}&page_size=100`,
    );
    sessions.push(...(res?.results ?? []));
    page = res?.pagination?.next || 0;
  }
  sessions.sort((a, b) => String(b.last_used).localeCompare(String(a.last_used)));
  return { settings, sessions };
}

// Ends these records, a few at a time (one by one took seconds).
async function endSessions(settings, sessions) {
  for (let i = 0; i < sessions.length; i += 5) {
    await Promise.all(
      sessions
        .slice(i, i + 5)
        .map((s) =>
          authentikApi(settings, `/core/authenticated_sessions/${s.uuid}/`, { method: 'DELETE' }),
        ),
    );
  }
}

const userAgentOf = (s) => s.last_user_agent ?? s.user_agent?.string ?? '';

// One row per device and address, newest first: { id, device, ip,
// lastUsedAt, expiresAt, count } - `count` records of it (the newest one's
// times), without the ones from localhost or the Docker network
// (internalAddress.js). null: the app has no Authentik API token.
export async function listAuthentikSessions(email) {
  const raw = await rawSessions(email);
  if (!raw) return null;
  const rows = new Map();
  for (const s of raw.sessions) {
    if (isInternalAddress(s.last_ip)) continue;
    const key = `${userAgentOf(s)}|${s.last_ip}`;
    const row = rows.get(key);
    if (row) {
      row.count += 1;
      continue;
    }
    rows.set(key, {
      id: s.uuid,
      device: deviceName(userAgentOf(s)),
      ip: s.last_ip ?? null,
      lastUsedAt: s.last_used ?? null,
      expiresAt: s.expires ?? null,
      count: 1,
    });
  }
  return [...rows.values()];
}

// How recently the session a login came through must have been used to be
// taken for it.
const JUST_USED_MS = 10 * 60000;

// After a login to the app from this browser: the newest Authentik session
// with its User-Agent is the one the login just came through; the older
// ones of the same browser and address are dead records - they go. Matched
// by Authentik's own address of it (the app may see another, e.g. localhost
// in development). Returns how many went.
export async function clearOlderAuthentikSessions(email, userAgent) {
  if (!userAgent) return 0;
  const raw = await rawSessions(email);
  if (!raw) return 0;
  const same = raw.sessions.filter((s) => userAgentOf(s) === userAgent);
  const newest = same[0];
  if (!newest || Date.now() - new Date(newest.last_used) > JUST_USED_MS) return 0;
  const older = same.slice(1).filter((s) => s.last_ip === newest.last_ip);
  await endSessions(raw.settings, older);
  return older.length;
}

// Logging out everywhere: every Authentik record of theirs goes - also the
// browser asking, as it can't be told which one that is (it stays logged in
// to the app, and Authentik asks for the password at its next visit).
// Returns how many went; null: no Authentik API token.
export async function endAuthentikSessions(email) {
  const raw = await rawSessions(email);
  if (!raw) return null;
  await endSessions(raw.settings, raw.sessions);
  return raw.sessions.length;
}
