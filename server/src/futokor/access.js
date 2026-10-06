import AppError from '../utils/appError.js';

// Who may use Futókör (the running race - Futókörök, a part of Móka):
// everyone logged in - guests too - since 2026-10-06 (while it was being
// built, only the role manager got in). The client's twin:
// auth/futokor.guard.ts's canSeeFutokor. What is the admins' alone (the
// club's cards, a tour's course) is said where it's done: the routes and
// futokorController.js.
export const canUseFutokor = (user) => !!user;

// After requireAuth.
export function requireFutokor(req, res, next) {
  if (!canUseFutokor(req.user)) {
    return next(new AppError('A Futókör még nem nyílt meg.', 403));
  }
  next();
}
