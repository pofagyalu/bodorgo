import AppError from '../utils/appError.js';
import User from '../models/userModel.js';
import { noteActive } from '../utils/activity.js';

export default async function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return next(new AppError('Not authenticated. Please login.', 401));
  }

  const user = await User.findById(req.session.user.id);
  if (!user) {
    return next(new AppError('The user belonging to this session no longer exists.', 401));
  }
  // Felfüggesztve (Klub → Felhasználók): suspending ends their sessions,
  // but one that still comes (a socket's, a race) is refused all the same.
  if (user.retired) {
    return next(new AppError('A fiókod fel van függesztve.', 401));
  }

  req.user = user;
  // Here today (Klub → Statisztika's active users) - once a day per device.
  noteActive(user, req);
  next();
}

// The one admin who may change roles (utils/roleManager.js) - and the only
// one for what can lock everybody out (Beállítások → OIDC szolgáltató).
export const roleManagerOnly = (req, res, next) => {
  if (!req.user.canManageRoles) {
    return next(new AppError('Ezt csak a szerepkör-kezelő admin teheti meg.', 403));
  }
  next();
};

export const restrictTo =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(new AppError('You dont have permission to perform this action', 403));
    }
    next();
  };
