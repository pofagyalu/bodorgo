import AppError from '../utils/appError.js';

// Who may use Móka (the games). While they're being built: only the one
// initial admin (the role manager, see utils/roleManager.js) - not the
// other admins. Once they're ready, this is the line that opens them to
// everyone logged in (the client's twin: auth/moka.guard.ts).
export const canUseMoka = (user) => !!user?.canManageRoles;

// After requireAuth.
export function requireMoka(req, res, next) {
  if (!canUseMoka(req.user)) {
    return next(new AppError('A Móka még nem nyílt meg.', 403));
  }
  next();
}
