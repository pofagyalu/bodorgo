import AppError from '../utils/appError.js';

// Who may use Móka (the games): everyone logged in - opened on 2026-10-04
// (while the games were being built, only the role manager got in). The
// client's twin: auth/moka.guard.ts. The running race is not part of this:
// it has a gate of its own (futokor/access.js).
export const canUseMoka = (user) => !!user;

// After requireAuth.
export function requireMoka(req, res, next) {
  if (!canUseMoka(req.user)) {
    return next(new AppError('A Móka még nem nyílt meg.', 403));
  }
  next();
}
