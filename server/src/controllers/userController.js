import User from '../models/userModel.js';
import Reservation from '../models/reservationModel.js';
import AppError from '../utils/appError.js';

const filterObj = (obj, ...allowedFields) => {
  const newObj = {};
  Object.keys(obj).forEach((el) => {
    if (allowedFields.includes(el)) newObj[el] = obj[el];
  });

  return newObj;
};

// Admin-only (see userRoutes.js) - lets an admin sanity-check the
// hand-curated family data (server/scripts/createFamily.js etc.) by seeing
// every person's name/email/familyId in one place. Sorted so family
// members sit next to each other rather than in creation order.
export const getAllUsers = async (req, res) => {
  const users = await User.find()
    .select('name email familyId role sub createdAt')
    .sort('familyId name');

  res.status(200).json({
    status: 'success',
    results: users.length,
    data: { users },
  });
};

export const updateMe = async (req, res, next) => {
  if (req.body.password || req.body.passwordConfirm) {
    throw new AppError('This route is not for password update.', 400);
  }

  const filteredBody = filterObj(req.body, 'name', 'email');

  const updatedUser = await User.findByIdAndUpdate(req.user._id, filteredBody, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    status: 'success',
    data: {
      user: updatedUser,
    },
  });
};

// Powers the "which tours have I attended" list on the profile page - every
// reservation where the current user shows up as an attendee, whether they
// booked it themselves or a family member (see userModel.js's familyId)
// booked it for them.
export const getMyAttendance = async (req, res) => {
  const reservations = await Reservation.find({ 'attendees.user': req.user._id })
    .populate('tour', 'title slug order startDate imageCover')
    .sort('-createdAt');

  const tours = reservations
    .filter((r) => r.tour) // guards against a tour that's since been deleted
    .map((r) => ({
      tour: r.tour,
      paid: r.paid,
    }));

  res.status(200).json({ status: 'success', data: { tours } });
};

export const deleteMe = async (req, res, next) => {
  await User.findByIdAndUpdate(req.user._id, { active: false });

  res.status(204).json({
    status: 'success',
    data: null,
  });
};

export const getUser = (req, res) => {
  res.status(500).json({
    status: 'error',
    message: 'this route is not yet implemented',
  });
};

export const createUser = (req, res) => {
  res.status(500).json({
    status: 'error',
    message: 'this route is not yet implemented',
  });
};

// used for admin updates other users
export const updateUser = (req, res) => {
  res.status(500).json({
    status: 'error',
    message: 'this route is not yet implemented',
  });
};

export const deleteUser = (req, res) => {
  res.status(500).json({
    status: 'error',
    message: 'this route is not yet implemented',
  });
};
