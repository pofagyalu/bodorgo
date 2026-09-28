import fs from 'fs';
import mongoose from 'mongoose';
import multer from 'multer';
import Post, { POST_POPULATE } from '../models/postModel.js';
import Tour from '../models/tourModel.js';
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
import { emitToTour, getIo } from '../chat/tourEvents.js';
import { notifyChatPostInBackground } from '../chat/chatNotifications.js';

// A photo sent in a tour chat (see chat/chatImages.js). Sent as a normal
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

// POST /tours/:tourId/chat/images - multipart: image (+ optional text).
export const postChatImage = async (req, res) => {
  const { tourId } = req.params;
  if (!mongoose.isValidObjectId(tourId) || !(await Tour.exists({ _id: tourId }))) {
    throw new AppError('Nincs ilyen tábor.', 404);
  }
  if (!req.file) throw new AppError('Nincs kép kiválasztva.', 400);

  const { chatImages } = await getClubSettings();
  const limit = chatImages?.dailyLimit ?? 10;
  if ((await photosSentToday(req.user._id)) >= limit) {
    throw new AppError(`Ma már elküldtél ${limit} fotót – holnap újra küldhetsz.`, 429);
  }

  const post = new Post({
    tourId,
    creator: req.user._id,
    text: String(req.body?.text ?? '')
      .trim()
      .slice(0, 4000),
  });
  try {
    post.image = await saveChatImage(post._id, req.file.buffer);
  } catch (err) {
    logger.warn(`chat image for tour ${tourId} could not be read: ${err.message}`);
    throw new AppError('Ez a fájl nem kép, vagy nem olvasható.', 400);
  }
  await post.save();

  const populated = await post.populate(POST_POPULATE);
  emitToTour(tourId, 'new-post', populated);
  const io = getIo();
  if (io) notifyChatPostInBackground(io, populated);
  enforceChatImageQuota().catch((err) =>
    logger.error(`chat image quota check failed: ${err.message}`),
  );

  res.status(201).json({ status: 'success', data: { post: populated } });
};

// A photo still on disk, of a message in this tour that wasn't deleted.
async function servable(req) {
  const { tourId, postId } = req.params;
  if (!mongoose.isValidObjectId(postId)) throw new AppError('Nincs ilyen fotó.', 404);
  const post = await Post.exists({
    _id: postId,
    tourId,
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

// GET /tours/:tourId/chat/images/:postId - the photo; .../thumb - the small one.
export const getChatImage = async (req, res) => send(res, chatImagePath(await servable(req)));
export const getChatImageThumb = async (req, res) => send(res, chatThumbPath(await servable(req)));
