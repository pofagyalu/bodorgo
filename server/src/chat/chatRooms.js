import mongoose from 'mongoose';
import ChatRoom from '../models/chatRoomModel.js';
import Tour from '../models/tourModel.js';
import AppError from '../utils/appError.js';

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

// A tour's Kotyogó closes this many days after the tour's last day: from
// then on it's an archive - it can be read, but not written in.
export const CHAT_OPEN_DAYS_AFTER_TOUR = 14;
// One past tour's chat stays writable: the one the chat is tested in. It's
// still a past tour - listed among the archives (the client has the same
// exception - pages/chat/chat.ts).
const ALWAYS_WRITABLE_TOUR_ORDER = 11;

// Past: more than 14 days after the tour's last day - its chat is listed
// among the archives.
export function tourChatPast(tour, now = new Date()) {
  const pastFrom = new Date(tour.startDate);
  pastFrom.setDate(pastFrom.getDate() + Math.max(tour.duration - 1, 0) + CHAT_OPEN_DAYS_AFTER_TOUR);
  return now > pastFrom;
}

// Closed: a past tour's chat can't be written in any more.
export function tourChatClosed(tour, now = new Date()) {
  return tour.order !== ALWAYS_WRITABLE_TOUR_ORDER && tourChatPast(tour, now);
}

// Is this room read-only? Only a tour's can be (the general one never
// closes); a room whose tour is gone counts as closed.
export async function chatRoomClosed(room) {
  if (room.type !== 'tour') return false;
  const tour = await Tour.findById(room.tourId).select('startDate duration order');
  return !tour || tourChatClosed(tour);
}

export const CHAT_CLOSED_MESSAGE = 'Ez a Kotyogó már lezárult – csak olvasható.';

// What the client gets about a room.
export const chatRoomView = (room) => ({
  _id: String(room._id),
  type: room.type,
  tourId: room.tourId ? String(room.tourId) : null,
});
