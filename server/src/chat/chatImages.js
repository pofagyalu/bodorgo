import fs from 'fs';
import path from 'path';
import Post, { POST_POPULATE } from '../models/postModel.js';
import { CHAT_IMAGES_DIR } from '../utils/dataDirs.js';
import { getClubSettings } from '../utils/clubSettings.js';
import { loadSharp } from '../photos/imageFiles.js';
import { budapestDate } from '../utils/membershipReminders.js';
import { emitToChatRoom } from './tourEvents.js';

// Photos in the chats. The phone already shrinks a photo before
// sending it; here it's made into a WebP of at most 1600 px - about a third
// smaller than a JPEG of the same quality - (EXIF - the
// GPS location included - dropped: sharp writes none unless asked) and a
// small .webp thumbnail for the message bubble. The folder is kept under
// an admin-set size quota: once over it, the oldest photos go first - their
// messages stay, showing "no longer available".

const MAX_SIDE = 1600;
const THUMB_SIDE = 480;

export const chatImagePath = (postId) => path.join(CHAT_IMAGES_DIR, `${postId}.webp`);
export const chatThumbPath = (postId) => path.join(CHAT_IMAGES_DIR, `${postId}.thumb.webp`);

// The photo and its thumbnail, from the uploaded bytes - throws if it isn't
// a real image. Returns what the message records about it.
export async function saveChatImage(postId, buffer) {
  const sharp = await loadSharp();
  fs.mkdirSync(CHAT_IMAGES_DIR, { recursive: true });
  const full = await sharp(buffer)
    .rotate() // upright by its EXIF orientation, before that's dropped
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });
  const thumb = await sharp(full.data)
    .resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer();
  fs.writeFileSync(chatImagePath(postId), full.data);
  fs.writeFileSync(chatThumbPath(postId), thumb);
  return {
    width: full.info.width,
    height: full.info.height,
    size: full.data.length + thumb.length,
  };
}

export function deleteChatImageFiles(postId) {
  fs.rmSync(chatImagePath(postId), { force: true });
  fs.rmSync(chatThumbPath(postId), { force: true });
}

// How many photos this person has sent today (Budapest day) - against the
// daily limit.
export async function photosSentToday(userId, now = new Date()) {
  const today = budapestDate(now);
  const since = new Date(now.getTime() - 26 * 60 * 60 * 1000); // enough to cover "today"
  const recent = await Post.find({
    creator: userId,
    image: { $ne: null },
    createdAt: { $gte: since },
  }).select('createdAt');
  return recent.filter((p) => budapestDate(p.createdAt) === today).length;
}

// What the photos on disk take up now (the ones still there).
export async function chatImagesUsage() {
  const [row] = await Post.aggregate([
    { $match: { image: { $ne: null }, 'image.expired': { $ne: true } } },
    { $group: { _id: null, bytes: { $sum: '$image.size' }, count: { $sum: 1 } } },
  ]);
  return { bytes: row?.bytes ?? 0, count: row?.count ?? 0 };
}

// Over the quota: the oldest photos go (files deleted, the message marked
// expired and updated live) until it fits again. Returns how many went.
export async function enforceChatImageQuota() {
  const { chatImages } = await getClubSettings();
  const limit = (chatImages?.quotaMB ?? 1024) * 1024 * 1024;
  let { bytes } = await chatImagesUsage();
  if (bytes <= limit) return 0;

  const oldest = Post.find({ image: { $ne: null }, 'image.expired': { $ne: true } })
    .sort('createdAt')
    .cursor();
  let removed = 0;
  for (let post = await oldest.next(); post && bytes > limit; post = await oldest.next()) {
    deleteChatImageFiles(post._id);
    bytes -= post.image.size ?? 0;
    post.image.expired = true;
    await post.save();
    const populated = await post.populate(POST_POPULATE);
    emitToChatRoom(post.chatRoomId, 'post-updated', populated);
    removed++;
  }
  await oldest.close();
  return removed;
}
