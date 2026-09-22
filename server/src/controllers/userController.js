import mongoose from 'mongoose';
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

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

// Age is derived, never stored - birthday is the only real field, this
// just computes the age as of a given moment from it (today by default).
// Returns null rather than a bogus number when there's no birthday on
// record yet. The optional asOf lets reservationController.js's
// computeAttendeePayments ask "how old were they on the tour's own
// startDate" for per-person child-pricing eligibility, rather than their
// current age - see that function's own comment on why that distinction
// matters.
export function computeAge(birthday, asOf = new Date()) {
  if (!birthday) return null;
  const today = new Date(asOf);
  const birth = new Date(birthday);
  let age = today.getFullYear() - birth.getFullYear();
  const hadBirthdayThisYear =
    today.getMonth() > birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());
  if (!hadBirthdayThisYear) age--;
  return age;
}

// The admin table only ever shows the last 6 characters of a familyId (see
// getAllUsers's comment and profile.html's family-tag) - the full 24-char
// id is only reachable via a hover tooltip, so typing that short suffix
// into the add/edit form is the natural (and only realistically
// discoverable) thing to do. Resolves either a full id or a suffix of one
// already in use to the real, full familyId.
export async function resolveFamilyId(input) {
  const trimmed = input.trim();
  if (OBJECT_ID_RE.test(trimmed)) {
    return trimmed;
  }

  const suffix = trimmed.toLowerCase();
  const candidates = await User.find({ familyId: { $exists: true } }).select('familyId');
  const matches = [
    ...new Set(
      candidates
        .map((u) => u.familyId.toString())
        .filter((id) => id.toLowerCase().endsWith(suffix)),
    ),
  ];

  if (matches.length === 0) {
    throw new AppError(`Nem található család ezzel az azonosítóval: "${input}".`, 400);
  }
  if (matches.length > 1) {
    throw new AppError(
      `Több család azonosítója is végződik erre: "${input}" - adj meg egy hosszabb részletet.`,
      400,
    );
  }
  return matches[0];
}

// An admin gets the full roster with every management field, including
// the "Táborok" column's tour count; a plain 'member' can also see the
// whole list now (name/email/age/gender only - no familyId/role/
// lastLoginAt/toursAttended, and no raw birthday, just the computed age),
// but never the fields that back admin-only actions like editing or the
// family/role/tour-count columns. A 'guest' still can't call this at all
// (see userRoutes.js's restrictTo) - they only ever see their own family,
// via getMyFamily.
export const getAllUsers = async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const selectFields = isAdmin
    ? 'name email familyId role sub lastLoginAt createdAt birthday gender'
    : 'name email birthday gender';

  const users = await User.find().select(selectFields).sort('name').lean();

  // How many distinct tours each user has actually attended - counted from
  // Reservation.attendees rather than stored on User, same source of truth
  // getMyAttendance uses. $addToSet dedupes in case a user was somehow
  // added as an attendee on more than one reservation for the same tour.
  let toursAttendedById = new Map();
  if (isAdmin) {
    const attendanceCounts = await Reservation.aggregate([
      { $unwind: '$attendees' },
      { $group: { _id: '$attendees.user', tours: { $addToSet: '$tour' } } },
      { $project: { toursAttended: { $size: '$tours' } } },
    ]);
    toursAttendedById = new Map(attendanceCounts.map((a) => [String(a._id), a.toursAttended]));
  }

  // birthday itself is only ever needed by the admin's edit form (see
  // profile.ts's startEditUser) - a 'member' viewer gets the computed age
  // only, never the raw date.
  const withAge = users.map((u) => {
    const age = computeAge(u.birthday);
    if (isAdmin) return { ...u, age, toursAttended: toursAttendedById.get(String(u._id)) ?? 0 };
    const { birthday, ...rest } = u;
    return { ...rest, age };
  });

  res.status(200).json({
    status: 'success',
    results: withAge.length,
    data: { users: withAge },
  });
};

// Every logged-in user can see their own family's roster (their own
// familyId, see userModel.js) - not just an admin. Excludes the caller
// themselves, since a "your family members" list doesn't need to list you.
export const getMyFamily = async (req, res) => {
  if (!req.user.familyId) {
    return res.status(200).json({ status: 'success', data: { members: [] } });
  }

  const members = await User.find({
    familyId: req.user.familyId,
    _id: { $ne: req.user._id },
  })
    .select('name email role')
    .sort('name');

  res.status(200).json({ status: 'success', data: { members } });
};

export const updateMe = async (req, res, next) => {
  if (req.body.password || req.body.passwordConfirm) {
    throw new AppError('This route is not for password update.', 400);
  }

  const filteredBody = filterObj(req.body, 'name', 'email', 'wantsEmailNotifications');

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
      // This specific attendee's own paid status (see
      // reservationModel.js's attendeeSchema.paid), not the whole
      // reservation's - a family reservation can have some members paid
      // and others not.
      paid: r.attendees.find((a) => String(a.user) === String(req.user._id))?.paid ?? false,
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

// Admin-only (see userRoutes.js) - for quickly entering historical people
// by hand, same identity model as the family scripts (createFamily.js
// etc.): omitting familyId starts a brand new family for this one person,
// giving one joins them into that existing family directly.
export const createUser = async (req, res) => {
  const { name, email, familyId, birthday, gender } = req.body;
  if (!name) {
    throw new AppError('A névnek nem lehet üres.', 400);
  }

  const user = await User.create({
    name,
    email: email ? email.toLowerCase() : undefined,
    familyId: familyId ? await resolveFamilyId(familyId) : new mongoose.Types.ObjectId(),
    birthday: birthday || undefined,
    gender: gender || undefined,
  });

  res.status(201).json({
    status: 'success',
    data: { user: { ...user.toObject(), age: computeAge(user.birthday) } },
  });
};

// Admin-only - edits name/email/familyId by hand. familyId as an empty
// string explicitly removes the user from their family (rather than the
// field being silently ignored), for undoing a mistaken assignment.
export const updateUser = async (req, res) => {
  const { name, email, familyId, birthday, gender } = req.body;

  const set = {};
  const unset = {};
  if (name !== undefined) set.name = name;
  if (email !== undefined) set.email = email ? email.toLowerCase() : null;
  if (familyId !== undefined) {
    if (familyId) set.familyId = await resolveFamilyId(familyId);
    else unset.familyId = 1;
  }
  if (birthday !== undefined) {
    if (birthday) set.birthday = birthday;
    else unset.birthday = 1;
  }
  if (gender !== undefined) {
    if (gender) set.gender = gender;
    else unset.gender = 1;
  }

  const ops = {};
  if (Object.keys(set).length) ops.$set = set;
  if (Object.keys(unset).length) ops.$unset = unset;

  const user = await User.findByIdAndUpdate(req.params.id, ops, {
    new: true,
    runValidators: true,
  });

  if (!user) {
    throw new AppError('No user found with that ID!', 404);
  }

  res.status(200).json({
    status: 'success',
    data: { user: { ...user.toObject(), age: computeAge(user.birthday) } },
  });
};

// Admin-only - groups several existing users into one shared family in a
// single call, for exactly the "these people clearly belong together but
// don't have a common familyId yet" cleanup case. Reuses whichever single
// familyId (if any) already appears among the selection, so extending an
// existing family with newly-matched members works too; refuses to
// silently merge two already-different families, since either could have
// other members outside this selection that would otherwise get orphaned
// from the choice made here.
export const joinFamily = async (req, res) => {
  const { userIds } = req.body;
  if (!Array.isArray(userIds) || userIds.length < 2) {
    throw new AppError('Legalább 2 felhasználót ki kell választani.', 400);
  }

  const users = await User.find({ _id: { $in: userIds } }).select('familyId');
  if (users.length !== userIds.length) {
    throw new AppError('Néhány kiválasztott felhasználó nem található.', 404);
  }

  const existingFamilyIds = [
    ...new Set(users.filter((u) => u.familyId).map((u) => u.familyId.toString())),
  ];

  if (existingFamilyIds.length > 1) {
    throw new AppError(
      'A kiválasztott felhasználók már különböző családokhoz tartoznak - ezt kézzel kell rendezni.',
      400,
    );
  }

  const familyId = existingFamilyIds[0] || new mongoose.Types.ObjectId();

  await User.updateMany({ _id: { $in: userIds } }, { familyId });

  const updatedUsers = await User.find({ _id: { $in: userIds } })
    .select('name email familyId role sub lastLoginAt createdAt birthday gender')
    .sort('name')
    .lean();
  const withAge = updatedUsers.map((u) => ({ ...u, age: computeAge(u.birthday) }));

  res.status(200).json({ status: 'success', data: { users: withAge, familyId } });
};

export const deleteUser = (req, res) => {
  res.status(500).json({
    status: 'error',
    message: 'this route is not yet implemented',
  });
};
