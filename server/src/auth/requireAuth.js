import AppError from '../utils/appError.js';
import User from '../models/userModel.js';

export default async function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return next(new AppError('Not authenticated. Please login.', 401));
  }

  const user = await User.findById(req.session.user.id);
  if (!user) {
    return next(
      new AppError('The user belonging to this session no longer exists.', 401),
    );
  }

  req.user = user;
  next();
}

export const restrictTo =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError('You dont have permission to perform this action', 403),
      );
    }
    next();
  };
