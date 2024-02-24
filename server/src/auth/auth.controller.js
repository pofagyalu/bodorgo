import crypto from 'crypto';

import User from '../user/user.model';
import AuthMethod from './auth.method.model';
import catchAsync from '../utils/catch-async';
import AppError from '../utils/app-error';
import Email from '../email/email';
import { isTokenValid, attachCookiesToResponse } from '../utils/jwt';

const createSendToken = (user, statusCode, res) => {
  const tokenUser = { id: user._id, role: user.role };

  attachCookiesToResponse({ res, user: tokenUser });

  res.status(statusCode).json({
    status: 'success',
    data: {
      user,
    },
  });
};

export const signup = catchAsync(async (req, res, next) => {
  const isFirstAccount = (await User.countDocuments({}, { limit: 1 })) === 0;
  const role = isFirstAccount ? 'admin' : 'user';

  const user = await User.create({
    name: req.body.name,
    firstName: req.body.firstName,
    lastName: req.body.lastName,
    email: req.body.email,
    role,
  });

  const auth = await AuthMethod.create({
    type: 'PASSWORD',
    secret: req.body.password,
    user: user.id,
  });

  const verificationToken = auth.createVerificationToken();
  await auth.save();

  const emailVerifyUrl = `${req.protocol}://${req.get('host')}/v1/users/verify-email?${verificationToken}&email=${user.email}`;

  try {
    await new Email(user, emailVerifyUrl).sendWelcome();

    res.status(200).json({
      status: 'success',
      message: 'Token sent to email',
    });
  } catch (err) {
    auth.verificationToken = undefined;
    await auth.save();
    return next(new AppError('There was an error sending the email.', 500));
  }
});

export const verifyEmail = catchAsync(async (req, res, next) => {
  const { verificationToken, email } = req.body;

  const user = await User.findOne({ email });

  if (!user) {
    return next(
      new AppError('The user linked with the token does not exist.', 401),
    );
  }

  const hashedToken = crypto
    .createHash('sha256')
    .update(verificationToken)
    .digest('hex');

  const authUser = await AuthMethod.findOne({
    verificationToken: hashedToken,
  });

  if (!authUser) {
    return next(new AppError('Email verification failed', 400));
  }

  user.emailVerified = true;
  user.emailVerifiedAt = Date.now();
  authUser.verificationToken = undefined;
  await user.save({ validateBeforeSave: false });
  await authUser.save();

  res.status(200).json({
    status: 'success',
    message: 'Email verified',
  });
});

export const login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return next(new AppError('Please provide email and password', 400));
  }

  const user = await User.findOne({ email }).select('+emailVerified');
  if (!user) {
    return next(new AppError('No user found.', 400));
  }

  if (!user.emailVerified) {
    return next(
      new AppError(
        'Email confirmation in progress, please check your inbox.',
        401,
      ),
    );
  }

  if (user.isLocked) {
    return next(
      new AppError(
        'Too many login attempts. Please try again 5 minutes later',
        429,
      ),
    );
  }

  const auth = await AuthMethod.findOne({
    user: user._id,
    type: 'PASSWORD',
  });

  if (await auth.correctPassword(password, auth.secret)) {
    if (user.loginAttempts) {
      await user.updateOne({
        $set: { loginAttempts: 0 },
        $unset: { lockUntil: 1 },
      });
    }
  } else {
    await user.incLoginAttempts();
    return next(new AppError('Wrong credentials. Please try again.', 401));
  }

  createSendToken(user, 200, res);
});

export const logout = async (req, res, next) => {
  res.cookie('authToken', 'logout', {
    httpOnly: true,
    expires: new Date(Date.now()),
  });
  res.status(200).json({
    status: 'success',
    message: 'User logged out!',
  });
};

export const protect = catchAsync(async (req, res, next) => {
  if (req.method === 'OPTIONS') {
    return next();
  }
  const { authToken } = req.signedCookies;

  if (!authToken) {
    const error = new AppError('Authentication Invalid', 401);
    return next(error);
  }

  let decodedToken;
  try {
    decodedToken = isTokenValid(authToken);
  } catch (err) {
    return next(err);
  }

  const currentUser = await User.findById(decodedToken.id);
  if (!currentUser) {
    return next(
      new AppError(
        'The user belonging to this token does no longer exist.',
        401,
      ),
    );
  }

  if (currentUser.changedPasswordAfter(decodedToken.iat)) {
    return next(
      new AppError('User recently changed password! Please login again.', 401),
    );
  }

  req.currentUser = currentUser;

  next();
});

export const restrictTo =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.currentUser.role)) {
      return next(
        new AppError('Yoy do not have permission to perform this action', 403),
      );
    }

    next();
  };

export const forgotPassword = catchAsync(async (req, res, next) => {
  const user = await User.findOne({ email: req.body.email });

  if (!user) {
    return next(new AppError('There is no user with email address.', 404));
  }

  const auth = await AuthMethod.findOne({
    user: user._id,
    type: 'PASSWORD',
  });
  const resetToken = auth.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  const resetURL = `${req.protocol}://${req.get('host')}/api/v1/users/resetPassword/${resetToken}`;

  try {
    // await sendEmail({
    //   email: user.email,
    //   subject: 'Your password reset token (valid for 10 min)',
    //   message,
    // });

    await new Email(user, resetURL).sendPasswordReset();
    res.status(200).json({
      status: 'success',
      message: 'Token sent to email',
    });
  } catch (err) {
    auth.secretResetToken = undefined;
    auth.secretResetExpired = undefined;
    await user.save({ validateBeforeSave: false });
    return next(
      new AppError(
        'There was an error sending the email. Try again later',
        500,
      ),
    );
  }
});

export const resetPassword = catchAsync(async (req, res, next) => {
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  if (!user) {
    return next(new AppError('Token is invalid or has expired', 400));
  }

  user.password = req.body.password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;

  await user.save();

  createSendToken(user, 200, res);
});

export const updatePassword = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.currentUser.id);

  if (!(await user.correctPassword(req.body.passwordCurrent, user.password))) {
    return next(new AppError('Your current password is wrong', 401));
  }

  user.password = req.body.passwordNew;

  await user.save();

  createSendToken(user, 200, res);
});
