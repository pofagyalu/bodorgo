import Post, { POST_POPULATE, REACTIONS } from '../models/postModel.js';
import ChatRoom from '../models/chatRoomModel.js';
import logger from '../logger.js';
import { chatChannel, setIo, tourRoom } from './tourEvents.js';
import { lastReadAt, markChatRead, notifyChatPostInBackground } from './chatNotifications.js';
import { deleteChatImageFiles } from './chatImages.js';
import { CHAT_CLOSED_MESSAGE, chatRoomClosed } from './chatRooms.js';
import { onGeneralTextPostInBackground } from './firstWritersGame.js';

// One Socket.IO connection per open browser tab (see the client's
// TourSocketService), in two kinds of channels:
// - a tour's (join-tour): its Szobabeosztás changes ("rooms-changed");
// - a chat room's (join-chat): its messages, reactions and polls - the
//   general Kotyogó or a tour's (see chatRoomModel.js).
export default function registerChatHandlers(io) {
  setIo(io);

  io.on('connection', (socket) => {
    const sessionUser = socket.request.session?.user;
    // Who this socket is, and which chat room it's showing right now - so
    // chat push notifications skip whoever is already looking at it (see
    // chatNotifications.js).
    socket.data.userId = sessionUser?.id ?? null;
    socket.data.visibleChat = null;
    const markRead = (chatRoomId) =>
      sessionUser &&
      markChatRead(sessionUser.id, chatRoomId).catch((err) =>
        logger.error(`chat: mark read failed: ${err}`),
      );
    const notLoggedIn = () => socket.emit('chat-error', 'Not authenticated. Please login.');

    // A tour's page: its Szobabeosztás updates.
    socket.on('join-tour', ({ tourId } = {}) => {
      if (!sessionUser) return notLoggedIn();
      if (tourId) socket.join(tourRoom(tourId));
    });

    socket.on('leave-tour', ({ tourId } = {}) => {
      if (tourId) socket.leave(tourRoom(tourId));
    });

    // Opening a chat room: its channel, and its history.
    socket.on('join-chat', async ({ chatRoomId } = {}) => {
      if (!sessionUser) return notLoggedIn();
      if (!chatRoomId) return;
      try {
        if (!(await ChatRoom.exists({ _id: chatRoomId }))) {
          return socket.emit('chat-error', 'Nincs ilyen Kotyogó.');
        }
        socket.join(chatChannel(chatRoomId));
        socket.data.visibleChat = String(chatRoomId);
        // When they last had it open - before this opening counts as one:
        // the chat opens at the first message they haven't seen.
        const readAt = await lastReadAt(sessionUser.id, chatRoomId);
        markRead(chatRoomId);
        const posts = await Post.find({ chatRoomId }).sort('createdAt').populate(POST_POPULATE);
        socket.emit('initial-posts', { chatRoomId: String(chatRoomId), posts, readAt });
      } catch (err) {
        logger.error(`chat: failed to load posts for chat room ${chatRoomId}: ${err}`);
        socket.emit('chat-error', 'Could not load chat history.');
      }
    });

    // Switching to another chat on the same connection.
    // What arrived while it was on screen was seen: read up to now (the
    // list of chats shows nothing unread for it).
    socket.on('leave-chat', ({ chatRoomId } = {}) => {
      if (chatRoomId) socket.leave(chatChannel(chatRoomId));
      if (socket.data.visibleChat === String(chatRoomId)) {
        markRead(chatRoomId);
        socket.data.visibleChat = null;
      }
    });

    // The same when the tab is closed with a chat on screen.
    socket.on('disconnect', () => {
      if (socket.data.visibleChat) markRead(socket.data.visibleChat);
    });

    // The chat's tab went to the background (or came back) - only a
    // visible chat counts as "already looking at it".
    socket.on('chat-visible', ({ chatRoomId, visible } = {}) => {
      if (!chatRoomId || !socket.rooms.has(chatChannel(chatRoomId))) return;
      socket.data.visibleChat = visible ? String(chatRoomId) : null;
      if (visible) markRead(chatRoomId);
    });

    socket.on('create-post', async ({ chatRoomId, text } = {}) => {
      if (!sessionUser) return notLoggedIn();
      if (!chatRoomId || !text?.trim()) return;

      try {
        const room = await ChatRoom.findById(chatRoomId);
        if (!room) return socket.emit('chat-error', 'Nincs ilyen Kotyogó.');
        // A past tour's chat is an archive: read, not written.
        if (await chatRoomClosed(room)) return socket.emit('chat-error', CHAT_CLOSED_MESSAGE);
        const post = await Post.create({
          chatRoomId,
          creator: sessionUser.id,
          text: text.trim(),
        });
        const populated = await post.populate(POST_POPULATE);
        io.to(chatChannel(chatRoomId)).emit('new-post', populated);
        markRead(chatRoomId);
        notifyChatPostInBackground(io, populated);
        // The launch game: the first three to write in the general room.
        if (room.type === 'general') onGeneralTextPostInBackground(io, populated);
      } catch (err) {
        logger.error(`chat: failed to save post in chat room ${chatRoomId}: ${err}`);
        socket.emit('chat-error', 'Could not send message.');
      }
    });

    // Editing/deleting: only ever the author's own, not-yet-deleted post.
    // Everyone in the chat room gets the changed post ('post-updated').
    const loadOwnPost = async (postId) => {
      if (!sessionUser || !postId) return null;
      const post = await Post.findById(postId);
      if (!post || post.deletedAt || String(post.creator) !== sessionUser.id) return null;
      // A poll's message is managed from its card (close/delete - see
      // pollController.js), not edited like text.
      if (post.poll) return null;
      return post;
    };

    socket.on('edit-post', async ({ postId, text }) => {
      try {
        const post = await loadOwnPost(postId);
        if (!post || !text?.trim()) {
          return socket.emit('chat-error', 'Ezt az üzenetet nem szerkesztheted.');
        }
        post.text = text.trim();
        post.editedAt = new Date();
        await post.save();
        const populated = await post.populate(POST_POPULATE);
        io.to(chatChannel(post.chatRoomId)).emit('post-updated', populated);
      } catch (err) {
        logger.error(`chat: failed to edit post ${postId}: ${err}`);
        socket.emit('chat-error', 'Could not edit message.');
      }
    });

    socket.on('delete-post', async ({ postId }) => {
      try {
        const post = await loadOwnPost(postId);
        if (!post) {
          return socket.emit('chat-error', 'Ezt az üzenetet nem törölheted.');
        }
        post.text = '';
        if (post.image) deleteChatImageFiles(post._id);
        post.image = null;
        post.reactions = [];
        post.deletedAt = new Date();
        await post.save();
        const populated = await post.populate(POST_POPULATE);
        io.to(chatChannel(post.chatRoomId)).emit('post-updated', populated);
      } catch (err) {
        logger.error(`chat: failed to delete post ${postId}: ${err}`);
        socket.emit('chat-error', 'Could not delete message.');
      }
    });

    // Hangulatjel: one per person on a message - another one replaces
    // mine, the same one again takes it back. Anyone else's message (not
    // my own, not a deleted one); everyone in the chat sees it change ('post-updated').
    // No push notification - a 👍 shouldn't make phones buzz.
    socket.on('react-post', async ({ postId, emoji }) => {
      if (!sessionUser) {
        return socket.emit('chat-error', 'Not authenticated. Please login.');
      }
      if (!REACTIONS.includes(emoji)) return;
      try {
        const post = await Post.findById(postId);
        if (!post || post.deletedAt || String(post.creator) === sessionUser.id) return;
        const mine = post.reactions.find((r) => String(r.user) === sessionUser.id);
        if (mine?.emoji === emoji) {
          post.reactions = post.reactions.filter((r) => r !== mine);
        } else if (mine) {
          mine.emoji = emoji;
        } else {
          post.reactions.push({ user: sessionUser.id, emoji });
        }
        await post.save();
        const populated = await post.populate(POST_POPULATE);
        io.to(chatChannel(post.chatRoomId)).emit('post-updated', populated);
      } catch (err) {
        logger.error(`chat: failed to react to post ${postId}: ${err}`);
        socket.emit('chat-error', 'Could not save the reaction.');
      }
    });
  });
}
