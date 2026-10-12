import mongoose from 'mongoose';
import ChatRoom from '../models/chatRoomModel.js';
import Tour from '../models/tourModel.js';
import AppError from '../utils/appError.js';
import config from '../config.js';
import { huDate } from '../utils/huDate.js';

// Finding (or making, the first time) the chat rooms - see chatRoomModel.js.

// The room matching `filter`, made if there's none yet. Two requests at
// once can't make two: the unique indexes stop the second insert, which
// then just reads what the first one made.
async function findOrCreate(filter) {
  try {
    return await ChatRoom.findOneAndUpdate(
      filter,
      { $setOnInsert: filter },
      { upsert: true, returnDocument: 'after', runValidators: true },
    );
  } catch (err) {
    if (err?.code === 11000) return ChatRoom.findOne(filter);
    throw err;
  }
}

export const generalChatRoom = () => findOrCreate({ type: 'general', tourId: null });

// A tour's own room. Throws a 404 for a tour that doesn't exist.
export async function tourChatRoom(tourId) {
  if (!mongoose.isValidObjectId(tourId) || !(await Tour.exists({ _id: tourId }))) {
    throw new AppError('Nincs ilyen tábor.', 404);
  }
  return findOrCreate({ type: 'tour', tourId: new mongoose.Types.ObjectId(String(tourId)) });
}

// An existing room by its id - a 404 otherwise.
export async function loadChatRoom(chatRoomId) {
  const room = mongoose.isValidObjectId(chatRoomId) ? await ChatRoom.findById(chatRoomId) : null;
  if (!room) throw new AppError('Nincs ilyen Kotyogó.', 404);
  return room;
}

// A tour's Kotyogó closes when the tour is over - at midnight after its
// last day: from then on it's an archive - it can be read, but not written
// in.
// One past tour's chat stays writable: the one the chat is tested in. It's
// still a past tour - listed among the archives (the client has the same
// exception - pages/chat/chat.ts).
const ALWAYS_WRITABLE_TOUR_ORDER = 11;

// Past: from midnight after the tour's last day (startDate + duration
// days, in local time - the same moment as reviewController.js's
// tourHasEnded) - its chat is listed among the archives.
export function tourChatPast(tour, now = new Date()) {
  const pastFrom = new Date(tour.startDate);
  pastFrom.setHours(0, 0, 0, 0);
  pastFrom.setDate(pastFrom.getDate() + tour.duration);
  return now >= pastFrom;
}

// Closed: a past tour's chat can't be written in any more.
export function tourChatClosed(tour, now = new Date()) {
  return tour.order !== ALWAYS_WRITABLE_TOUR_ORDER && tourChatPast(tour, now);
}

// The general Kotyogó ("Bódorgók") can be kept shut until a set moment
// (config.generalChatOpensAt - the site's launch): when it opens, while
// that is still ahead - null once it is open (or no moment is set).
export function generalChatOpensAt(now = new Date()) {
  const at = config.generalChatOpensAt ? new Date(config.generalChatOpensAt) : null;
  return at && !Number.isNaN(at.getTime()) && now < at ? at : null;
}

// Is this room read-only? A tour's once the tour is over (a room whose
// tour is gone counts as closed); the general one until it opens.
export async function chatRoomClosed(room) {
  if (room.type !== 'tour') return !!generalChatOpensAt();
  const tour = await Tour.findById(room.tourId).select('startDate duration order');
  return !tour || tourChatClosed(tour);
}

export const CHAT_CLOSED_MESSAGE = 'Ez a Kotyogó már lezárult – csak olvasható.';

// What whoever tries to write in a closed room is told: a tour's is over,
// the general one hasn't opened yet.
export function chatClosedMessage(room) {
  const opensAt = room.type !== 'tour' ? generalChatOpensAt() : null;
  return opensAt
    ? `Ez a Kotyogó még zárva van – megnyitás: ${huDate(opensAt)}`
    : CHAT_CLOSED_MESSAGE;
}

// What the client gets about a room.
export const chatRoomView = (room) => ({
  _id: String(room._id),
  type: room.type,
  tourId: room.tourId ? String(room.tourId) : null,
});
