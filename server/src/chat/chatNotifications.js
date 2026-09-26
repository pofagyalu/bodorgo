import Reservation from '../models/reservationModel.js';
import Tour from '../models/tourModel.js';
import User from '../models/userModel.js';
import Post from '../models/postModel.js';
import ChatReadState from '../models/chatReadStateModel.js';
import { sendPushToUsers } from '../utils/push.js';
import logger from '../logger.js';
import { tourRoom } from './tourEvents.js';

// Push notifications for a tour's chat - to the tour's attendees, without
// the phone ringing at every message:
// - one buzz, then quiet: after a notification, further messages only
//   update the same notification silently ("5 új üzenet") until the chat
//   is opened again;
// - nothing for someone who has the chat open (and visible) right now;
// - a mention (@username) always buzzes;
// - a chat can be muted (see setChatMuted).

const SNIPPET_LENGTH = 90;

// The user had the chat open - notifications may buzz again next time.
export async function markChatRead(userId, tourId) {
  await ChatReadState.updateOne({ user: userId, tour: tourId }, { readAt: new Date() }, { upsert: true });
}

export async function setChatMuted(userId, tourId, muted) {
  await ChatReadState.updateOne({ user: userId, tour: tourId }, { muted: !!muted }, { upsert: true });
}

export async function isChatMuted(userId, tourId) {
  return !!(await ChatReadState.exists({ user: userId, tour: tourId, muted: true }));
}

// Users with the chat open and visible on some device right now (see the
// 'chat-visible' event in chatSocket.js).
async function watchingUserIds(io, tourId) {
  const sockets = await io.in(tourRoom(tourId)).fetchSockets();
  return new Set(sockets.filter((s) => s.data.visibleTour === String(tourId)).map((s) => s.data.userId));
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function mentions(text, username) {
  if (!username) return false;
  return new RegExp(`@${escapeRegExp(username)}(?![\\p{L}\\p{N}_])`, 'iu').test(text);
}

export async function notifyChatPost(io, post) {
  const tourId = String(post.tourId);
  const authorId = String(post.creator._id ?? post.creator);
  const authorName = post.creator.username || post.creator.name || 'Valaki';

  const reservations = await Reservation.find({ tour: tourId }).select('attendees.user');
  const attendeeIds = [...new Set(reservations.flatMap((r) => r.attendees.map((a) => String(a.user))))].filter(
    (id) => id !== authorId,
  );
  if (!attendeeIds.length) return;

  const watching = await watchingUserIds(io, tourId);
  const candidates = attendeeIds.filter((id) => !watching.has(id));
  if (!candidates.length) return;

  const [tour, users, states] = await Promise.all([
    Tour.findById(tourId).select('title order'),
    User.find({ _id: { $in: candidates } }).select('username'),
    ChatReadState.find({ tour: tourId, user: { $in: candidates } }),
  ]);
  const stateByUser = new Map(states.map((s) => [String(s.user), s]));
  const usernameById = new Map(users.map((u) => [String(u._id), u.username]));

  const title = tour ? `${tour.order ? `${tour.order}. ` : ''}${tour.title} – chat` : 'Bódorgó chat';
  const text = post.text.length > SNIPPET_LENGTH ? `${post.text.slice(0, SNIPPET_LENGTH - 1)}…` : post.text;

  for (const userId of candidates) {
    const state = stateByUser.get(userId);
    if (state?.muted) continue;
    const readAt = state?.readAt ?? new Date(0);

    const unread = await Post.countDocuments({
      tourId,
      createdAt: { $gt: readAt },
      creator: { $ne: userId },
      deletedAt: null,
    });
    const mentioned = mentions(post.text, usernameById.get(userId));
    // A buzz only if nothing has buzzed since they last read the chat -
    // otherwise the same notification just updates, silently.
    const alreadyBuzzed = !!state?.notifiedAt && state.notifiedAt > readAt;
    const loud = mentioned || !alreadyBuzzed;

    const sent = await sendPushToUsers([userId], {
      title,
      body: unread > 1 ? `${unread} új üzenet · ${authorName}: ${text}` : `${authorName}: ${text}`,
      tag: `chat-${tourId}`,
      url: `/chat?tabor=${tourId}`,
      silent: !loud,
      renotify: loud,
    });
    if (sent && loud) {
      await ChatReadState.updateOne({ user: userId, tour: tourId }, { notifiedAt: new Date() }, { upsert: true });
    }
  }
}

// Fire-and-forget from the socket handler - a notification problem never
// affects the chat itself.
export function notifyChatPostInBackground(io, post) {
  notifyChatPost(io, post).catch((err) => logger.error(`chat push for post ${post._id} failed: ${err.message}`));
}
