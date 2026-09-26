import createApp from '../../src/app.js';

// The real Express app, with a stand-in for the session: a test says who
// it is with the x-test-user header (see asUser), instead of logging in
// through Authentik. No header = logged out. requireAuth.js still loads the
// user from the (test) database, exactly as in production.
function fakeSession(req, res, next) {
  const raw = req.get('x-test-user');
  req.session = {
    user: raw ? JSON.parse(raw) : undefined,
    save: (cb) => cb?.(),
    destroy: (cb) => cb?.(),
    regenerate: (cb) => cb?.(),
  };
  next();
}

export const app = createApp(fakeSession);

// Headers that make a request come from this (already created) user.
export function asUser(user) {
  return {
    'x-test-user': JSON.stringify({ id: String(user._id), role: user.role, name: user.name }),
  };
}
