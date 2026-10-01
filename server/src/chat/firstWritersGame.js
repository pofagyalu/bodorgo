import ChatGame from '../models/chatGameModel.js';
import Post, { POST_POPULATE } from '../models/postModel.js';
import User from '../models/userModel.js';
import { isInitialAdmin } from '../utils/roleManager.js';
import logger from '../logger.js';
import { chatChannel } from './tourEvents.js';
import { notifyChatPostInBackground } from './chatNotifications.js';

// "The first three to write in Bódorgók" - a game played once, at the
// site's launch.
//
// - It starts by itself: with the organizer's (the INITIAL_ADMIN_USER's)
//   first text message in the general room after this is deployed - their
//   instructions. From then on the podium shows in that chat, empty.
// - The first three other people to send a text message there (one letter
//   is enough; a photo or a reaction doesn't count) take the 1st, 2nd and
//   3rd place - one place a person, anyone but the organizer.
// - Each new winner is announced to everyone in the chat right away
//   ('chat-game', with the place just taken - the podium celebrates it).
// - With the third winner it's over: the result is posted in the chat in
//   the organizer's name, and the podium stays for a day more.
// - It never starts again: its one record (ChatGame) stays.
//
// The server decides the winners - by the order the messages arrive here.

const KEY = 'first-writers';
const PLACES = 3;
// How long the podium still shows after the last place is taken.
const SHOWN_AFTER_MS = 24 * 3600 * 1000;
const MEDALS = ['🥇', '🥈', '🥉'];

// What the client gets: null when there's nothing to show (not started, or
// over for more than a day) - otherwise the winners so far, in order.
async function gameView(game, now = new Date()) {
  if (!game) return null;
  if (game.finishedAt && now - game.finishedAt > SHOWN_AFTER_MS) return null;
  const users = await User.find({ _id: { $in: game.winners.map((w) => w.user) } }).select(
    'name username photoUpdatedAt',
  );
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return {
    startedAt: game.startedAt,
    finishedAt: game.finishedAt,
    places: PLACES,
    winners: game.winners.map((w, i) => {
      const user = byId.get(String(w.user));
      return {
        place: i + 1,
        userId: String(w.user),
        name: user?.name ?? '',
        username: user?.username ?? null,
        photoUpdatedAt: user?.photoUpdatedAt ?? null,
        at: w.at,
      };
    }),
  };
}

// GET /chat-rooms/general/game.
export const currentGame = async () => gameView(await ChatGame.findOne({ key: KEY }));

// The result, as a message in the chat from the organizer.
async function announce(io, game, view) {
  const lines = view.winners.map((w) => `${MEDALS[w.place - 1]} ${w.place}. hely: ${w.name}`);
  const post = await Post.create({
    chatRoomId: game.chatRoom,
    creator: game.startedBy,
    text: `🏆 Megvannak a játék nyertesei!\n${lines.join('\n')}\nGratulálunk!`,
  });
  const populated = await post.populate(POST_POPULATE);
  io.to(chatChannel(String(game.chatRoom))).emit('new-post', populated);
  notifyChatPostInBackground(io, populated);
}

// Called for every new TEXT message in the general room (chatSocket.js's
// create-post), after it has been saved and sent out.
export async function onGeneralTextPost(io, post) {
  const author = post.creator?._id ?? post.creator;
  let game = await ChatGame.findOne({ key: KEY });

  if (!game) {
    // Not started yet: only the organizer's message starts it.
    const user = await User.findById(author).select('email');
    if (!user || !isInitialAdmin(user.email)) return;
    try {
      game = await ChatGame.create({
        key: KEY,
        chatRoom: post.chatRoomId,
        startedBy: author,
        startedAt: new Date(),
      });
    } catch (err) {
      if (err?.code === 11000) return; // two messages at once: started by the other
      throw err;
    }
    logger.info(`first-writers game started by ${user.email}`);
    io.to(chatChannel(String(post.chatRoomId))).emit('chat-game', {
      game: await gameView(game),
      newPlace: null,
    });
    return;
  }

  if (game.finishedAt || String(game.startedBy) === String(author)) return;

  // One step that can't be taken twice: the place goes to this author only
  // if they have none yet and one is still free - two messages arriving
  // together get two different places, in the order they're stored.
  const updated = await ChatGame.findOneAndUpdate(
    {
      key: KEY,
      finishedAt: null,
      'winners.user': { $ne: author },
      [`winners.${PLACES - 1}`]: { $exists: false },
    },
    { $push: { winners: { user: author, at: new Date() } } },
    { returnDocument: 'after' },
  );
  if (!updated) return;

  const place = updated.winners.findIndex((w) => String(w.user) === String(author)) + 1;
  const last = updated.winners.length >= PLACES;
  if (last) {
    updated.finishedAt = new Date();
    await updated.save();
  }
  const view = await gameView(updated);
  logger.info(`first-writers game: place ${place} taken`);
  io.to(chatChannel(String(updated.chatRoom))).emit('chat-game', { game: view, newPlace: place });
  if (last) await announce(io, updated, view);
}

// Never lets the game break the chat: a failure is only logged.
export function onGeneralTextPostInBackground(io, post) {
  onGeneralTextPost(io, post).catch((err) =>
    logger.error(`first-writers game failed on post ${post._id}: ${err.message}`),
  );
}
