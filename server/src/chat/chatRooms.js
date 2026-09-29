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

// What the client gets about a room.
export const chatRoomView = (room) => ({
  _id: String(room._id),
  type: room.type,
  tourId: room.tourId ? String(room.tourId) : null,
});
