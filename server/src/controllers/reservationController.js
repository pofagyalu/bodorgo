import Tour from '../models/tourModel.js';
import Reservation from '../models/reservationModel.js';
import User from '../models/userModel.js';
import AppError from '../utils/appError.js';

// Who a given caller is allowed to register depends on their role:
// - guest: only themselves.
// - member: themselves and anyone sharing their familyId (see
//   userModel.js) - a member can book for their whole family in one go.
// - admin: anyone at all (registering people on their behalf, e.g. from
//   phone/in-person sign-ups).
// Throws if any requested id falls outside what the caller is allowed to
// pick - never trusts the client beyond what this check allows, same
// principle as the old self-only version this replaces.
async function assertCanRegister(user, attendeeIds) {
  if (user.role === 'admin') return;

  if (user.role === 'guest') {
    if (attendeeIds.length !== 1 || attendeeIds[0] !== user._id.toString()) {
      throw new AppError('Vendégként csak saját magadat jelentkeztetheted.', 403);
    }
    return;
  }

  // member
  const allowedIds = new Set([user._id.toString()]);
  if (user.familyId) {
    const familyMembers = await User.find({ familyId: user.familyId }).select('_id');
    familyMembers.forEach((m) => allowedIds.add(m._id.toString()));
  }
  const disallowed = attendeeIds.filter((id) => !allowedIds.has(id));
  if (disallowed.length) {
    throw new AppError('Csak saját magadat és a hozzátartozóidat jelentkeztetheted.', 403);
  }
}

// Registers one or more people for a tour in a single reservation -
// exactly who is allowed depends on the caller's role, see
// assertCanRegister above. bookedBy is always the logged-in caller, even
// when they're registering only other people (e.g. an admin signing up a
// member who called in), so it's always clear who to contact about a
// reservation.
export const signUpForTour = async (req, res) => {
  const tour = await Tour.findById(req.params.tourId);
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }

  const attendeeIds = [
    ...new Set(
      Array.isArray(req.body.attendeeIds) && req.body.attendeeIds.length
        ? req.body.attendeeIds.map(String)
        : [req.user._id.toString()],
    ),
  ];

  await assertCanRegister(req.user, attendeeIds);

  const attendeeUsers = await User.find({ _id: { $in: attendeeIds } }).select('name');
  if (attendeeUsers.length !== attendeeIds.length) {
    throw new AppError('Néhány kiválasztott résztvevő nem található.', 404);
  }

  const existingReservations = await Reservation.find({ tour: tour._id }).select('attendees.user');
  const alreadyRegisteredIds = new Set(
    existingReservations.flatMap((r) => r.attendees.map((a) => a.user.toString())),
  );
  const duplicates = attendeeUsers.filter((u) => alreadyRegisteredIds.has(u._id.toString()));
  if (duplicates.length) {
    throw new AppError(
      `${duplicates.map((u) => u.name).join(', ')} már jelentkezett erre a táborra.`,
      400,
    );
  }

  const currentCount = existingReservations.reduce((sum, r) => sum + r.attendees.length, 0);
  if (currentCount + attendeeUsers.length > tour.maxCapacity) {
    throw new AppError('Ez a tábor sajnos megtelt.', 400);
  }

  const reservation = await Reservation.create({
    tour: tour._id,
    bookedBy: req.user._id,
    attendees: attendeeUsers.map((u) => ({ user: u._id, name: u.name })),
  });
  await reservation.populate('bookedBy', 'name email');

  res.status(201).json({ status: 'success', data: { reservation } });
};
