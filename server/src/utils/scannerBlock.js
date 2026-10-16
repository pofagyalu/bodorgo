import logger from '../logger.js';

// Bots that sweep the internet for leaked secrets and known holes (/.env,
// /wp-admin, terraform state, ICEcoder...) ask for hundreds of addresses
// this server doesn't have, in a few seconds. People never do: the app only
// asks for its own routes. So an IP asking for more than UNKNOWN_LIMIT
// unknown addresses within UNKNOWN_WINDOW_MS is shut out for BLOCK_MS -
// every request of it answered 429 at once, without reaching the app. The
// error log gets one line when it is blocked, not one per request.
//
// Only the "Can't find ... on this server" addresses count - never the
// app's own 404s (a deleted item, a photo that's gone), which a real user
// can meet. Kept in memory: a restart forgets it, which is fine.

export const UNKNOWN_LIMIT = 30;
export const UNKNOWN_WINDOW_MS = 60 * 1000;
export const BLOCK_MS = 60 * 60 * 1000;
// More IPs than this being tracked: the stale ones are dropped.
const MAX_TRACKED = 10_000;

const unknownHits = new Map(); // ip -> { count, since }
const blocked = new Map(); // ip -> until (ms)

function prune(now) {
  for (const [ip, hit] of unknownHits) {
    if (now - hit.since > UNKNOWN_WINDOW_MS) unknownHits.delete(ip);
  }
  for (const [ip, until] of blocked) if (until <= now) blocked.delete(ip);
}

// Called by the catch-all for an address the server doesn't have.
export function noteUnknownAddress(ip, now = Date.now()) {
  if (!ip) return;
  if (unknownHits.size > MAX_TRACKED) prune(now);
  const hit = unknownHits.get(ip);
  if (!hit || now - hit.since > UNKNOWN_WINDOW_MS) {
    unknownHits.set(ip, { count: 1, since: now });
    return;
  }
  hit.count++;
  if (hit.count > UNKNOWN_LIMIT && !blocked.has(ip)) {
    blocked.set(ip, now + BLOCK_MS);
    unknownHits.delete(ip);
    // Once, in the error log - "429 - " like the other 4xx lines, so it is
    // never e-mailed (utils/errorMail.js).
    logger.error(
      `429 - Scanner blocked for ${BLOCK_MS / 60000} min: ${ip} (over ${UNKNOWN_LIMIT} unknown addresses in ${UNKNOWN_WINDOW_MS / 1000} s)`,
    );
  }
}

export function isBlocked(ip, now = Date.now()) {
  const until = blocked.get(ip);
  if (until === undefined) return false;
  if (until > now) return true;
  blocked.delete(ip);
  return false;
}

// Early in app.js: a blocked IP gets nothing more.
export function blockScanners(req, res, next) {
  if (!isBlocked(req.ip)) return next();
  res.status(429).json({ status: 'fail', message: 'Túl sok kérés erről a címről.' });
}

// The tests start each from a clean slate.
export function resetScannerBlock() {
  unknownHits.clear();
  blocked.clear();
}
