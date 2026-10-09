import AppError from '../utils/appError.js';

// A session lives for 90 days (session.js), so a phone left somewhere is a
// logged-in phone. What moves money or rights - a role, a cash payment, a
// payout, where a payout goes - is therefore done only by someone who
// proved who they are in the last few minutes: the provider asked them
// again (/auth/login?stepup=1 sends max_age) and said when in the ID
// token's auth_time, kept in the session as authAt (authOidcController.js).
// The app's own login moment is NOT it: a still-living provider session
// lets a login through without asking anything.
export const FRESH_LOGIN_MINUTES = 10;
export const FRESH_LOGIN_REQUIRED = 'fresh-login-required';
// What the provider is asked for when they identify again: a login there
// no older than this, or it asks. Half the ten minutes, so whoever comes
// back without having been asked still has minutes left for the operation.
export const STEP_UP_MAX_AGE_SECONDS = (FRESH_LOGIN_MINUTES * 60) / 2;

// How many seconds of it are left (0: has to identify again).
export function freshLoginSecondsLeft(req) {
  const authAt = Number(req.session?.user?.authAt);
  if (!Number.isFinite(authAt)) return 0;
  const left = authAt + FRESH_LOGIN_MINUTES * 60000 - Date.now();
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

// For a controller where only one branch is sensitive (a user's edit that
// changes the role too).
export function assertFreshLogin(req) {
  if (freshLoginSecondsLeft(req) > 0) return;
  throw new AppError('Ehhez a művelethez újra azonosítanod kell magad.', 403, FRESH_LOGIN_REQUIRED);
}

export const requireFreshLogin = (req, res, next) => {
  assertFreshLogin(req);
  next();
};
