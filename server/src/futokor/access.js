import AppError from '../utils/appError.js';

// Who may use Futókör (the running race, under Versenyek). While it's
// being built: only the one initial admin (the role manager, see
// utils/roleManager.js) - not the other admins. Once it's ready, this is
// the line that opens it to everyone logged in (the client's twin:
// auth/moka.guard.ts's canSeeFutokor).
export const canUseFutokor = (user) => !!user?.canManageRoles;

// After requireAuth.
export function requireFutokor(req, res, next) {
  if (!canUseFutokor(req.user)) {
    return next(new AppError('A Futókör még nem nyílt meg.', 403));
  }
  next();
}
