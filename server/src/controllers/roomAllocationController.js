import mongoose from 'mongoose';
import Tour from '../models/tourModel.js';
import Reservation from '../models/reservationModel.js';
import AppError from '../utils/appError.js';
import { emitToTour } from '../chat/tourEvents.js';

// The Szobabeosztás: who sleeps in which room of a tour's accommodation.
// A person's room lives on their own registration (reservationModel.js's
// attendee room), so a cancelled registration frees its place by itself.

async function loadTour(idOrSlug) {
  const query = mongoose.isValidObjectId(idOrSlug) ? { _id: idOrSlug } : { slug: idOrSlug };
  const tour = await Tour.findOne(query).select('accommodation');
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }
  return tour;
}

function roomIdsOf(tour) {
  return new Set(
    (tour.accommodation?.houses ?? []).flatMap((h) => h.rooms.map((r) => String(r._id))),
  );
}

// GET /tours/:id/rooms - any logged-in user. The houses/rooms plus every
// registered person with their current room (null = none yet), and
// whether the allocation is finalized.
export const getRoomBoard = async (req, res) => {
  const tour = await loadTour(req.params.id);
  const reservations = await Reservation.find({ tour: tour._id }).populate(
    'attendees.user',
    'name username photoUpdatedAt familyId',
  );

  const validRooms = roomIdsOf(tour);
  const people = reservations.flatMap((r) =>
    r.attendees.map((a) => ({
      attendeeId: String(a._id),
      userId: a.user?._id ? String(a.user._id) : null,
      name: a.name,
      username: a.user?.username || null,
      photoUpdatedAt: a.user?.photoUpdatedAt ?? null,
      familyId: a.user?.familyId ? String(a.user.familyId) : null,
      roomId: a.room && validRooms.has(String(a.room)) ? String(a.room) : null,
    })),
  );

  res.status(200).json({
    status: 'success',
    data: {
      houses: tour.accommodation?.houses ?? [],
      finalized: !!tour.accommodation?.finalized,
      people,
    },
  });
};

// PUT /tours/:id/rooms/assignment - admin-only. Puts one registered person
// into a room ({ attendeeId, roomId }) or takes them out ({ roomId: null }).
// Refused while the allocation is finalized, or if the room is full.
export const assignRoom = async (req, res) => {
  const tour = await loadTour(req.params.id);
  if (tour.accommodation?.finalized) {
    throw new AppError('A szobabeosztás véglegesítve van - módosítás előtt oldd fel.', 409);
  }

  const { attendeeId, roomId } = req.body ?? {};
  if (!attendeeId || !mongoose.isValidObjectId(attendeeId)) {
    throw new AppError('Hibás résztvevő.', 400);
  }

  if (roomId) {
    const room = (tour.accommodation?.houses ?? [])
      .flatMap((h) => h.rooms)
      .find((r) => String(r._id) === String(roomId));
    if (!room) {
      throw new AppError('Nincs ilyen szoba ennél a tábornál.', 400);
    }
    const reservations = await Reservation.find({ tour: tour._id }).select('attendees._id attendees.room');
    const occupants = reservations
      .flatMap((r) => r.attendees)
      .filter((a) => String(a.room) === String(roomId) && String(a._id) !== String(attendeeId)).length;
    if (occupants >= room.beds) {
      throw new AppError(`A(z) "${room.name}" már tele van.`, 409);
    }
  }

  const update = roomId
    ? { $set: { 'attendees.$.room': roomId } }
    : { $unset: { 'attendees.$.room': 1 } };
  const result = await Reservation.updateOne({ tour: tour._id, 'attendees._id': attendeeId }, update);
  if (!result.matchedCount) {
    throw new AppError('Ez a személy nincs regisztrálva erre a táborra.', 404);
  }

  emitToTour(tour._id, 'rooms-changed', { tourId: String(tour._id) });
  res.status(200).json({ status: 'success' });
};

// PUT /tours/:id/rooms/finalized - admin-only. { finalized: true | false }.
// A direct update of just this one flag - loadTour only loads the
// accommodation, and a .save() of that partial document ran the tour's
// save hooks (e.g. rebuilding the slug from the unloaded title) and failed.
export const setFinalized = async (req, res) => {
  const tour = await loadTour(req.params.id);
  const finalized = !!req.body?.finalized;
  await Tour.updateOne({ _id: tour._id }, { $set: { 'accommodation.finalized': finalized } });

  emitToTour(tour._id, 'rooms-changed', { tourId: String(tour._id) });
  res.status(200).json({ status: 'success', data: { finalized } });
};

// After the accommodation itself is edited: anyone whose room no longer
// exists goes back to "no room". Used by accommodationController.js.
export async function clearDeletedRooms(tour) {
  const valid = [...roomIdsOf(tour)].map((id) => new mongoose.Types.ObjectId(id));
  await Reservation.updateMany(
    { tour: tour._id },
    { $unset: { 'attendees.$[a].room': 1 } },
    { arrayFilters: [{ 'a.room': { $exists: true, $nin: valid } }] },
  );
  emitToTour(tour._id, 'rooms-changed', { tourId: String(tour._id) });
}
