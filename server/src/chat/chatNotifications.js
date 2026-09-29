import Reservation from '../models/reservationModel.js';
import Tour from '../models/tourModel.js';
import User from '../models/userModel.js';
import Post from '../models/postModel.js';
import ChatReadState from '../models/chatReadStateModel.js';
import ChatRoom from '../models/chatRoomModel.js';
import { sendPushToUsers } from '../utils/push.js';
import logger from '../logger.js';
import { chatChannel } from './tourEvents.js';
import { usernameKey } from '../utils/usernames.js';

// Push notifications for a chat room - a tour's goes to the tour's
// attendees, the general one to everyone - without the phone ringing at
// every message:
// - one buzz, then quiet: after a notification, further messages only
//   update the same notification silently ("5 új üzenet") until the chat
//   is opened again;
// - nothing for someone who has the chat open (and visible) right now;
// - a mention (@username) always buzzes;
// - a chat can be muted (see setChatMuted) - a mention still gets through.

const SNIPPET_LENGTH = 90;

// The user had the chat open - notifications may buzz again next time.
export async function markChatRead(userId, chatRoomId) {
  await ChatReadState.updateOne(
    { user: userId, chatRoom: chatRoomId },
    { readAt: new Date() },
    { upsert: true },
  );
}

export async function setChatMuted(userId, chatRoomId, muted) {
  await ChatReadState.updateOne(
    { user: userId, chatRoom: chatRoomId },
    { muted: !!muted },
    { upsert: true },
  );
}

export async function isChatMuted(userId, chatRoomId) {
  return !!(await ChatReadState.exists({ user: userId, chatRoom: chatRoomId, muted: true }));
}

// Users with the chat open and visible on some device right now (see the
// 'chat-visible' event in chatSocket.js).
async function watchingUserIds(io, chatRoomId) {
  const sockets = await io.in(chatChannel(chatRoomId)).fetchSockets();
  return new Set(
    sockets.filter((s) => s.data.visibleChat === String(chatRoomId)).map((s) => s.data.userId),
  );
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// "@bela" mentions Béla too - both sides compared without case or accents
// (see utils/usernames.js).
function mentions(text, username) {
  if (!username) return false;
  return new RegExp(`@${escapeRegExp(usernameKey(username))}(?![\\p{L}\\p{N}_])`, 'u').test(
    usernameKey(text),
  );
}

// The general room's address in the app.
export const GENERAL_CHAT_URL = '/chat?kotyogo=altalanos';

// Everyone who can use the general room - every account that isn't
// retired - minus `except`.
export async function generalAudienceIds(except = []) {
  const skip = new Set(except.map(String));
  const users = await User.find({ retired: { $ne: true } }).select('_id');
  return users.map((u) => String(u._id)).filter((id) => !skip.has(id));
}

// Who hears about what happens in a tour's chat, or the general one (tour
// null), and how it's labelled: "25. Sarud" / "Általános" and where a tap
// leads. The same for messages and polls.
export async function chatAudience(tour, except = []) {
  if (!tour) {
    return { ids: await generalAudienceIds(except), label: 'Általános', url: GENERAL_CHAT_URL };
  }
  const tourId = String(tour._id ?? tour);
  const t = tour.title ? tour : await Tour.findById(tourId).select('title order');
  return {
    ids: await tourAttendeeIds(tourId, except),
    label: t ? `${t.order ? `${t.order}. ` : ''}${t.title}` : 'Tábor',
    url: `/chat?tabor=${tourId}`,
  };
}

export async function notifyChatPost(io, post) {
  const chatRoomId = String(post.chatRoomId);
  const room = await ChatRoom.findById(chatRoomId);
  if (!room) return;
  const authorId = String(post.creator._id ?? post.creator);
  const authorName = post.creator.username || post.creator.name || 'Valaki';

  const audience = await chatAudience(room.type === 'tour' ? room.tourId : null, [authorId]);
  if (!audience.ids.length) return;

  const watching = await watchingUserIds(io, chatRoomId);
  const candidates = audience.ids.filter((id) => !watching.has(id));
  if (!candidates.length) return;

  const [users, states] = await Promise.all([
    User.find({ _id: { $in: candidates } }).select('username'),
    ChatReadState.find({ chatRoom: chatRoomId, user: { $in: candidates } }),
  ]);
  const stateByUser = new Map(states.map((s) => [String(s.user), s]));
  const usernameById = new Map(users.map((u) => [String(u._id), u.username]));

  const title = `${audience.label} – Kotyogó`;
  // A photo (with or without text) says so - a photo alone has no text.
  const body = post.image ? `📷 ${post.text || 'Fotó'}` : post.text;
  const text = body.length > SNIPPET_LENGTH ? `${body.slice(0, SNIPPET_LENGTH - 1)}…` : body;

  for (const userId of candidates) {
    const state = stateByUser.get(userId);
    const mentioned = mentions(post.text, usernameById.get(userId));
    // A muted chat stays quiet - except for a message that names them.
    if (state?.muted && !mentioned) continue;
    const readAt = state?.readAt ?? new Date(0);

    const unread = await Post.countDocuments({
      chatRoomId,
      createdAt: { $gt: readAt },
      creator: { $ne: userId },
      deletedAt: null,
    });
    // A buzz only if nothing has buzzed since they last read the chat -
    // otherwise the same notification just updates, silently.
    const alreadyBuzzed = !!state?.notifiedAt && state.notifiedAt > readAt;
    const loud = mentioned || !alreadyBuzzed;

    const sent = await sendPushToUsers([userId], {
      title,
      body: unread > 1 ? `${unread} új üzenet · ${authorName}: ${text}` : `${authorName}: ${text}`,
      tag: `chat-${chatRoomId}`,
      url: audience.url,
      silent: !loud,
      renotify: loud,
    });
    if (sent && loud) {
      await ChatReadState.updateOne(
        { user: userId, chatRoom: chatRoomId },
        { notifiedAt: new Date() },
        { upsert: true },
      );
    }
  }
}

// Fire-and-forget from the socket handler - a notification problem never
// affects the chat itself.
export function notifyChatPostInBackground(io, post) {
  notifyChatPost(io, post).catch((err) =>
    logger.error(`chat push for post ${post._id} failed: ${err.message}`),
  );
}

// A tour's attendees who can get a notification about it - everyone signed
// up, minus `except` (e.g. whoever caused it). Used for polls, which always
// buzz (they ask for action), unlike ordinary chat messages above.
export async function tourAttendeeIds(tourId, except = []) {
  const reservations = await Reservation.find({ tour: tourId }).select('attendees.user');
  const skip = new Set(except.map(String));
  return [...new Set(reservations.flatMap((r) => r.attendees.map((a) => String(a.user))))].filter(
    (id) => !skip.has(id),
  );
}

export function pushInBackground(userIds, payload) {
  if (!userIds.length) return;
  sendPushToUsers(userIds, payload).catch((err) => logger.error(`push failed: ${err.message}`));
}
