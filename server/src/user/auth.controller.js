import jwt from 'jsonwebtoken';
import crypto from 'crypto';

import config from '../config.js';
import User from './user.model.js';
import catchAsync from '../utils/catch-async.js';
import AppError from '../utils/app-error.js';
import sendEmail from '../email/email.js';

const jwtToken = (id, expiresIn = config.jwt.expiry) =>
  jwt.sign({ id }, config.jwt.secret, { expiresIn });

const createSendToken = (user, statusCode, res) => {
  const token = jwtToken(user._id);
  const cookieOptions = {
    expires: new Date(
      Date.now() + config.jwt.cookieExpiry * 24 * 60 * 60 * 1000,
    ),
    httpOnly: true,
  };
  if (config.nodeEnv === 'production') cookieOptions.secure = true;
  res.cookie('bodorgo_jwt', token, cookieOptions);

  user.password = undefined;

  res.status(statusCode).json({
    status: 'success',
    token,
    data: {
      user,
    },
  });
};

export const signup = catchAsync(async (req, res, next) => {
  const newUser = await User.create({
    name: req.body.name,
    firstName: req.body.firstName,
    lastName: req.body.lastName,
    email: req.body.email,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm,
  });

  createSendToken(newUser, 201, res);
});

export const login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return next(new AppError('Please provide email and password', 400));
  }

  const user = await User.findOne({ email }).select('+password');

  if (!user) {
    return next(new AppError('No user found', 400));
  }

  if (user.isLocked) {
    return next(
      new AppError(
        'Too many login attempts. Please try again 5 minutes later',
        429,
      ),
    );
  }

  if (await user.correctPassword(password, user.password)) {
    if (user.loginAttempts) {
      await user.updateOne({
        $set: { loginAttempts: 0 },
        $unset: { lockUntil: 1 },
      });
    }
  } else {
    await user.incLoginAttempts();
    return next(new AppError('Incorrect email or password', 401));
  }

  createSendToken(user, 200, res);
});

export const protect = catchAsync(async (req, res, next) => {
  if (req.method === 'OPTIONS') {
    return next();
  }

  if (!req.headers.authorization) {
    const error = new AppError(
      'Missing authorization header, please login.',
      401,
    );
    return next(error);
  }

  const authFragments = req.headers.authorization.split(' ');
  if (authFragments.length !== 2) {
    return next(new AppError('Invalid authorization header.', 401));
  }
  const token = authFragments[1];

  let decodedToken;
  try {
    decodedToken = jwt.verify(token, config.jwt.secret);
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

  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  const resetURL = `${req.protocol}://${req.get('host')}/v1/users/resetPassword/${resetToken}`;

  const message = `Forgot your password? Submit a PACTH request with your new password and passwordConfirm to: ${resetURL}\nIf you didn' foregt your password, please ignor this email!`;

  try {
    await sendEmail({
      email: user.email,
      subject: 'Your password reset token (valid for 10 min)',
      message,
    });

    res.status(200).json({
      status: 'success',
      message: 'Token sent to email',
    });
  } catch (err) {
    user.passwordResetToken = undefined;
    user.passwordResetExpired = undefined;
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
  user.passwordConfirm = req.body.passwordConfirm;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;

  await user.save();

  createSendToken(user, 200, res);
});

export const updatePassword = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.currentUser.id).select('+password');

  if (!(await user.correctPassword(req.body.passwordCurrent, user.password))) {
    return next(new AppError('Your current password is wrong', 401));
  }

  user.password = req.body.passwordNew;
  user.passwordConfirm = req.body.passwordConfirm;

  await user.save();

  createSendToken(user, 200, res);
});
