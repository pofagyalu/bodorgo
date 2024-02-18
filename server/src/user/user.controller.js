import User from './user.model.js';
import catchAsync from '../utils/catch-async.js';
import AppError from '../utils/app-error.js';

const filterObj = (obj, ...allowedFields) => {
  const newObj = {};

  Object.keys(obj).forEach((el) => {
    if (allowedFields.includes(el)) newObj[el] = obj[el];
  });

  return newObj;
};

export const getAllUsers = catchAsync(async (req, res, next) => {
  const users = await User.find();

  res.status(200).json({
    status: 'success',
    results: users.length,
    data: {
      users,
    },
  });
});

export const createUser = (req, res, next) => {
  res.status(500).json({
    status: 'error',
    message: 'This route is not yet defined',
  });
};

export const updateMe = catchAsync(async (req, res, next) => {
  if (req.body.password || req.body.passwordConfirm) {
    return next(
      new AppError(
        'This route is not for password updates. Please use /updateMyPassword',
        400,
      ),
    );
  }

  const filteredBody = filterObj(
    req.body,
    'name',
    'firstName',
    'lastName',
    'email',
  );
  const updatedUser = await User.findByIdAndUpdate(
    req.currentUser.id,
    filteredBody,
    {
      new: true,
      runValidators: true,
    },
  );

  res.status(200).json({
    status: 'success',
    data: {
      user: updatedUser,
    },
  });
});

export const deleteMe = catchAsync(async (req, res, next) => {
  await User.findByIdAndUpdate(req.currentUser.id, { active: false });

  res.status(204).json({
    status: 'success',
    data: null,
  });
});

export const getUser = (req, res, next) => {
  res.status(500).json({
    status: 'error',
    message: 'This route is not yet defined',
  });
};

export const updateUser = (req, res, next) => {
  // TODO
  // update esetében is save()-et használni, hogy működjön a
  // passwordConfirm
  res.status(500).json({
    status: 'error',
    message: 'This route is not yet defined',
  });
};

export const deleteUser = (req, res, next) => {
  res.status(500).json({
    status: 'error',
    message: 'This route is not yet defined',
  });
};
