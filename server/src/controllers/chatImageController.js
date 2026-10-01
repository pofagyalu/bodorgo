import fs from 'fs';
import mongoose from 'mongoose';
import multer from 'multer';
import Post, { POST_POPULATE } from '../models/postModel.js';
import User from '../models/userModel.js';
import AppError from '../utils/appError.js';
import logger from '../logger.js';
import { getClubSettings } from '../utils/clubSettings.js';
import {
  chatImagePath,
  chatThumbPath,
  enforceChatImageQuota,
  photosSentToday,
  saveChatImage,
} from '../chat/chatImages.js';
import { emitToChatRoom, getIo } from '../chat/tourEvents.js';
import {
  CHAT_CLOSED_MESSAGE,
  chatRoomClosed,
  chatRoomView,
  generalChatRoom,
  loadChatRoom,
  tourChatClosed,
  tourChatPast,
  tourChatRoom,
} from '../chat/chatRooms.js';
import { currentGame } from '../chat/firstWritersGame.js';
import ChatRoom from '../models/chatRoomModel.js';
import ChatReadState from '../models/chatReadStateModel.js';
import Reservation from '../models/reservationModel.js';
import Tour from '../models/tourModel.js';
import { backgroundPath, currentBackground, nextBackground } from '../chat/chatBackground.js';
import { LONG_CACHE } from '../photos/imageSizes.js';
import { notifyChatPostInBackground } from '../chat/chatNotifications.js';

// A photo sent in a chat room (see chat/chatImages.js). Sent as a normal
// request, not over the chat socket - the message then appears live for
// everyone the same way (new-post), with the usual push notification.

// The phone shrinks the photo first, so this is just a generous ceiling.
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new AppError('Csak kép küldhető.', 400));
      return;
    }
    cb(null, true);
  },
}).single('image');

// multer's own "too big" error as a message the chat can show.
export const chatImageUpload = (req, res, next) =>
  upload(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError('Túl nagy a kép (legfeljebb 12 MB).', 400));
    }
    next(err);
  });

// POST /chat-rooms/:chatRoomId/images - multipart: image (+ optional text).
export const postChatImage = async (req, res) => {
  const room = await loadChatRoom(req.params.chatRoomId);
  if (await chatRoomClosed(room)) throw new AppError(CHAT_CLOSED_MESSAGE, 403);
  if (!req.file) throw new AppError('Nincs kép kiválasztva.', 400);

  const { chatImages } = await getClubSettings();
  const limit = chatImages?.dailyLimit ?? 10;
  if ((await photosSentToday(req.user._id)) >= limit) {
    throw new AppError(`Ma már elküldtél ${limit} fotót – holnap újra küldhetsz.`, 429);
  }

  const post = new Post({
    chatRoomId: room._id,
    creator: req.user._id,
    text: String(req.body?.text ?? '')
      .trim()
      .slice(0, 4000),
  });
  try {
    post.image = await saveChatImage(post._id, req.file.buffer);
  } catch (err) {
    logger.warn(`chat image for chat room ${room._id} could not be read: ${err.message}`);
    throw new AppError('Ez a fájl nem kép, vagy nem olvasható.', 400);
  }
  await post.save();

  const populated = await post.populate(POST_POPULATE);
  emitToChatRoom(room._id, 'new-post', populated);
  const io = getIo();
  if (io) notifyChatPostInBackground(io, populated);
  enforceChatImageQuota().catch((err) =>
    logger.error(`chat image quota check failed: ${err.message}`),
  );

  res.status(201).json({ status: 'success', data: { post: populated } });
};

// A photo still on disk, of a message in this chat room that wasn't deleted.
async function servable(req) {
  const { chatRoomId, postId } = req.params;
  if (!mongoose.isValidObjectId(postId)) throw new AppError('Nincs ilyen fotó.', 404);
  const post = await Post.exists({
    _id: postId,
    chatRoomId,
    image: { $ne: null },
    'image.expired': { $ne: true },
    deletedAt: null,
  });
  if (!post) throw new AppError('Nincs ilyen fotó.', 404);
  return postId;
}

function send(res, file) {
  if (!fs.existsSync(file)) throw new AppError('Nincs ilyen fotó.', 404);
  // A photo never changes once sent - browsers may keep it.
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(file);
}

// GET /chat-rooms/:chatRoomId/images/:postId - the photo; .../thumb - the small one.
export const getChatImage = async (req, res) => send(res, chatImagePath(await servable(req)));
export const getChatImageThumb = async (req, res) => send(res, chatThumbPath(await servable(req)));

// --- The Kotyogó's background (see chat/chatBackground.js) ---

function validTourId(tourId) {
  if (!mongoose.isValidObjectId(tourId)) throw new AppError('Nincs ilyen tábor.', 404);
  return tourId;
}

// GET /tours/:tourId/chat/background - { background: { version } | null }.
export const getChatBackground = async (req, res) => {
  const background = await currentBackground(validTourId(req.params.tourId));
  res.status(200).json({ status: 'success', data: { background } });
};

// GET /tours/:tourId/chat/background/image?v=<version> - the pale WebP; the
// version in the address changes with it, so browsers may keep it a year.
export const getChatBackgroundImage = async (req, res) => {
  const file = backgroundPath(validTourId(req.params.tourId));
  if (!fs.existsSync(file)) throw new AppError('Ennek a Kotyogónak nincs háttérképe.', 404);
  res.set('Cache-Control', LONG_CACHE);
  res.sendFile(file);
};

// POST /tours/:tourId/chat/background/next (admin) - "Másik háttér".
export const nextChatBackground = async (req, res) => {
  const background = await nextBackground(validTourId(req.params.tourId));
  res.status(200).json({ status: 'success', data: { background } });
};

// --- The chat rooms themselves (see chat/chatRooms.js) ---

// GET /tours/:tourId/chat-room - the tour's own room, made on first use.
export const getTourChatRoom = async (req, res) => {
  const room = await tourChatRoom(req.params.tourId);
  res.status(200).json({ status: 'success', data: { chatRoom: chatRoomView(room) } });
};

// GET /chat-rooms/general - the club-wide room, made on first use.
export const getGeneralChatRoom = async (req, res) => {
  const room = await generalChatRoom();
  res.status(200).json({ status: 'success', data: { chatRoom: chatRoomView(room) } });
};

const OVERVIEW_SNIPPET_LENGTH = 80;

// GET /chat-rooms/overview - the list of Kotyogós (the phone's first chat
// screen): the general room and every tour's, each with its last message
// (who and what, shortened), how many messages the asker hasn't seen yet,
// and how many people it has - a tour's attendees, or everyone active for
// the general one. `past`: the tour is over (by more than two weeks) -
// its chat belongs with the archives; `closed`: it's read-only too (it has
// no unread count) - every past one but the test tour's. A tour nobody has opened yet has no room: chatRoomId null.
export const getChatOverview = async (req, res) => {
  const me = req.user._id;
  const [general, tourRooms, tours, readStates, attendeeCounts, activeUsers] = await Promise.all([
    generalChatRoom(),
    ChatRoom.find({ type: 'tour' }),
    Tour.find().select('order startDate duration'),
    ChatReadState.find({ user: me }).select('chatRoom readAt'),
    Reservation.aggregate([
      { $unwind: '$attendees' },
      { $group: { _id: '$tour', count: { $sum: 1 } } },
    ]),
    User.countDocuments({ retired: { $ne: true } }),
  ]);

  const rooms = [general, ...tourRooms];
  // Each room's latest message that wasn't deleted.
  const latest = await Post.aggregate([
    { $match: { chatRoomId: { $in: rooms.map((r) => r._id) }, deletedAt: null } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$chatRoomId', post: { $first: '$$ROOT' } } },
  ]);
  const authors = await User.find({ _id: { $in: latest.map((l) => l.post.creator) } }).select(
    'name username',
  );
  const authorOf = new Map(authors.map((u) => [String(u._id), u.username || u.name]));
  const lastPostOf = new Map(
    latest.map(({ _id, post }) => [
      String(_id),
      {
        author: authorOf.get(String(post.creator)) ?? '',
        text: (post.text ?? '').slice(0, OVERVIEW_SNIPPET_LENGTH),
        hasImage: !!post.image,
        isPoll: !!post.poll,
        createdAt: post.createdAt,
      },
    ]),
  );

  const readAtOf = new Map(readStates.map((s) => [String(s.chatRoom), s.readAt]));
  const unreadIn = (room) =>
    Post.countDocuments({
      chatRoomId: room._id,
      creator: { $ne: me },
      deletedAt: null,
      createdAt: { $gt: readAtOf.get(String(room._id)) ?? new Date(0) },
    });

  const roomOfTour = new Map(tourRooms.map((r) => [String(r.tourId), r]));
  const attendeesOf = new Map(attendeeCounts.map((a) => [String(a._id), a.count]));

  const tourEntries = await Promise.all(
    tours.map(async (tour) => {
      const room = roomOfTour.get(String(tour._id));
      const closed = tourChatClosed(tour);
      return {
        tourId: String(tour._id),
        chatRoomId: room ? String(room._id) : null,
        past: tourChatPast(tour),
        closed,
        lastPost: (room && lastPostOf.get(String(room._id))) ?? null,
        unread: room && !closed ? await unreadIn(room) : 0,
        memberCount: attendeesOf.get(String(tour._id)) ?? 0,
      };
    }),
  );

  res.status(200).json({
    status: 'success',
    data: {
      general: {
        chatRoomId: String(general._id),
        lastPost: lastPostOf.get(String(general._id)) ?? null,
        unread: await unreadIn(general),
        memberCount: activeUsers,
      },
      tours: tourEntries,
    },
  });
};

// GET /chat-rooms/general/game - the launch game's podium ("the first three
// to write in Bódorgók", see chat/firstWritersGame.js): null when there's
// nothing to show - not started yet, or over for more than a day.
export const getGeneralGame = async (req, res) => {
  res.status(200).json({ status: 'success', data: { game: await currentGame() } });
};

// GET /chat-rooms/general/people - who can be "@"-mentioned in the general
// room: everyone with a username who isn't retired.
export const getGeneralPeople = async (req, res) => {
  const users = await User.find({
    retired: { $ne: true },
    username: { $nin: [null, ''] },
  }).select('name username');
  res.status(200).json({
    status: 'success',
    data: {
      people: users.map((u) => ({ userId: String(u._id), name: u.name, username: u.username })),
    },
  });
};
