import createApp from '../../src/app.js';

// The real Express app, with a stand-in for the session: a test says who
// it is with the x-test-user header (see asUser), instead of logging in
// through Authentik. No header = logged out. requireAuth.js still loads the
// user from the (test) database, exactly as in production.
function fakeSession(req, res, next) {
  const raw = req.get('x-test-user');
  // Which session it is, for a test that needs one (x-test-session).
  req.sessionID = req.get('x-test-session');
  req.session = {
    user: raw ? JSON.parse(raw) : undefined,
    save: (cb) => cb?.(),
    destroy: (cb) => cb?.(),
    regenerate: (cb) => cb?.(),
  };
  next();
}

export const app = createApp(fakeSession);

// Headers that make a request come from this (already created) user - who
// identified themselves just now (auth/freshLogin.js), unless minutesAgo
// says how long ago; null: the provider never said when.
export function asUser(user, { minutesAgo = 0 } = {}) {
  return {
    'x-test-user': JSON.stringify({
      id: String(user._id),
      role: user.role,
      name: user.name,
      authAt: minutesAgo === null ? null : Date.now() - minutesAgo * 60000,
    }),
  };
}
