import jwt from 'jsonwebtoken';

import User from './user.model.js';
import catchAsync from '../utils/catch-async.js';
import config from '../config.js';
import AppError from '../utils/app-error.js';

const signToken = (id) =>
  jwt.sign({ id }, config.jwt.secret, {
    expiresIn: config.jwt.expiry,
  });

export const signup = catchAsync(async (req, res, next) => {
  const newUser = await User.create({
    name: req.body.name,
    firstName: req.body.firstName,
    lastName: req.body.lastName,
    email: req.body.email,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm,
  });

  const token = signToken(newUser._id);

  res.status(201).json({
    status: 'success',
    token,
    data: {
      user: { ...newUser._doc, password: undefined },
    },
  });
});

export const login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return next(new AppError('Please provide email and password', 400));
  }

  const user = await User.findOne({ email }).select('+password');

  if (!user || !(await user.correctPassword(password, user.password))) {
    return next(new AppError('Incorrect email or password', 401));
  }

  const token = signToken(user._id);
  res.status(200).json({
    status: 'success',
    token,
  });
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
