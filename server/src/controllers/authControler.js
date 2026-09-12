// LEGACY password-based auth — superseded by Authentik OIDC/PKCE login.
// See ../controllers/authOidcController.js and ../auth/requireAuth.js.
// Retained per instruction, not deleted; no route references this file anymore.

/*
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

import User from '../models/userModel.js';
import AppError from '../utils/appError.js';
import config from '../config.js';
import sendEmail from '../utils/email.js';
// import { verifyAccessToken } from '../auth/jwks.js';

const signToken = (id) =>
  jwt.sign({ id }, config.jwt.secret, { expiresIn: config.jwt.expiry });

const createAndSendToken = (user, statusCode, res) => {
  const token = signToken(user._id);

  const cookieOptions = {
    expires: new Date(Date.now() + config.jwt.cookieExpiry * 86400000),
    httpOnly: true,
  };

  if (config.nodeEnv === 'production') cookieOptions.secure = true;

  res.cookie('jwt', token, cookieOptions);

  user.password = undefined;

  res.status(statusCode).json({
    status: 'success',
    token,
    data: {
      user,
    },
  });
};

export const signup = async (req, res) => {
  const { email } = req.body;

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new AppError('The user already signed up, please login.', 401);
  }

  const newUser = {
    name: req.body.name,
    firstName: req.body.firstName,
    lastName: req.body.lastName,
    email,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm,
  };

  const createdUser = await User.create(newUser);

  if (!createdUser) {
    throw new AppError('Invalid data sent', 404);
  }

  createAndSendToken(createdUser, 201, res);
};

// TODO: max login attempts implementation
export const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new AppError('Please provide email and password.', 400);
  }

  const user = await User.findOne({ email }).select('+password');

  if (!user || !(await user.correctPassword(password, user.password))) {
    throw new AppError('Incorrect email or password.', 401);
  }

  createAndSendToken(user, 200, res);
};

export const protect = async (req, res, next) => {
  // 1) Getting token
  /*   if (!req.headers.authorization) {
    throw new AppError('Missing authorization header, please login.', 401);
  }

  const authFragments = req.headers.authorization.split(' ');
  if (authFragments.length !== 2) {
    throw new AppError('Invalid authorization header.', 401);
  }



  // 1) Get token from secure HttpOnly cookie
  const token = req.cookies.session;
  if (!token) {
    throw new AppError('Not authenticated. Please login.', 401);
  }

  // 2) Verification of token
  let decodedToken;
  try {
    decodedToken = jwt.verify(token, config.jwt.secret);
  } catch (err) {
    throw new AppError('Token verification failed.', 401);
  }

  // 3) Check if user still exist
  const freshUser = await User.findById(decodedToken.id);
  if (!freshUser) {
    throw new AppError(
      'The user belonging to this token does no longer exist.',
      401,
    );
  }

  // 4) Check if user changed password after token was issued
  if (freshUser.changedPasswordAfter(decodedToken.iat)) {
    throw new AppError(
      'User recently changed password! Please login again.',
      401,
    );
  }

  // GRANT ACCESS TO PROTECTED ROUTE
  req.user = freshUser;
  next();
};

export const restrictTo = (role) => (req, res, next) => {
  if (req.user.role !== role) {
    throw new AppError('You dont have permission to perform this action', 403);
  }
  next();
};

export const forgotPassword = async (req, res, next) => {
  const user = await User.findOne({ email: req.body.email });
  if (!user) {
    throw new AppError('There is no user with email address.', 404);
  }

  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  const resetUrl = `${req.protocol}://${req.get('host')}/api/v1/resetPassword/${resetToken}`;
  const message = `Forgot your password? Submit a patch request with your new password and passwordConfirm to: ${resetUrl}.\nIf you
  didn't forget your password, please ignre this email!`;

  try {
    await sendEmail({
      email: user.email,
      subject: 'Your password reset token (valid for 10 min',
      message,
    });
  } catch (err) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });

    throw new AppError(
      'There was an error sending email. Try again later!',
      500,
    );
  }

  res.status(200).json({
    status: 'success',
    message: 'Token sent to email.',
  });
};

export const resetPassword = async (req, res, next) => {
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  if (!user) {
    throw new AppError('Tokwn is invalid or has expired', 400);
  }

  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  createAndSendToken(user, 200, res);
};

export const updateMyPassword = async (req, res, next) => {
  const user = await User.findById(req.user._id).select('+password');

  if (!(await user.correctPassword(req.body.passwordCurrent, user.password))) {
    throw new AppError('Your current password is wrong', 401);
  }

  user.password = req.body.passwordNew;
  user.passwordConfirm = req.body.passwordConfirm;

  // If findByIdAndUpdate would be used all my pre-save functionality would not work!!!
  await user.save();

  createAndSendToken(user, 200, res);
};
*/
