import Post, { POST_POPULATE, REACTIONS } from '../models/postModel.js';
import logger from '../logger.js';
import { setIo, tourRoom } from './tourEvents.js';
import { markChatRead, notifyChatPostInBackground } from './chatNotifications.js';
import { deleteChatImageFiles } from './chatImages.js';

// One Socket.IO connection per open browser tab, shared by the tour chat
// and its Szobabeosztás panel (see the client's TourSocketService): joining
// a tour puts the socket in that tour's room, which carries both new chat
// posts and "rooms-changed" pushes (see tourEvents.js's emitToTour).
export default function registerChatHandlers(io) {
  setIo(io);

  io.on('connection', (socket) => {
    const sessionUser = socket.request.session?.user;
    // Who this socket is, and which chat it's showing right now - so chat
    // push notifications skip whoever is already looking at it (see
    // chatNotifications.js).
    socket.data.userId = sessionUser?.id ?? null;
    socket.data.visibleTour = null;
    const markRead = (tourId) =>
      sessionUser &&
      markChatRead(sessionUser.id, tourId).catch((err) =>
        logger.error(`chat: mark read failed: ${err}`),
      );

    socket.on('join-tour-chat', async ({ tourId }) => {
      if (!sessionUser) {
        return socket.emit('chat-error', 'Not authenticated. Please login.');
      }
      if (!tourId) return;

      socket.join(tourRoom(tourId));
      socket.data.visibleTour = String(tourId);
      markRead(tourId);

      try {
        const posts = await Post.find({ tourId }).sort('createdAt').populate(POST_POPULATE);
        socket.emit('initial-posts', { tourId, posts });
      } catch (err) {
        logger.error(`chat: failed to load posts for tour ${tourId}: ${err}`);
        socket.emit('chat-error', 'Could not load chat history.');
      }
    });

    // Switching to another tour on the chat page - stop getting this one's
    // posts/room changes on the same connection.
    socket.on('leave-tour-chat', ({ tourId }) => {
      if (tourId) socket.leave(tourRoom(tourId));
      if (socket.data.visibleTour === String(tourId)) socket.data.visibleTour = null;
    });

    // The chat's tab went to the background (or came back) - only a
    // visible chat counts as "already looking at it".
    socket.on('chat-visible', ({ tourId, visible }) => {
      if (!tourId || !socket.rooms.has(tourRoom(tourId))) return;
      socket.data.visibleTour = visible ? String(tourId) : null;
      if (visible) markRead(tourId);
    });

    socket.on('create-post', async ({ tourId, text }) => {
      if (!sessionUser) {
        return socket.emit('chat-error', 'Not authenticated. Please login.');
      }
      if (!tourId || !text?.trim()) return;

      try {
        const post = await Post.create({
          tourId,
          creator: sessionUser.id,
          text: text.trim(),
        });
        const populated = await post.populate(POST_POPULATE);
        io.to(tourRoom(tourId)).emit('new-post', populated);
        markRead(tourId);
        notifyChatPostInBackground(io, populated);
      } catch (err) {
        logger.error(`chat: failed to save post for tour ${tourId}: ${err}`);
        socket.emit('chat-error', 'Could not send message.');
      }
    });

    // Editing/deleting: only ever the author's own, not-yet-deleted post.
    // Everyone in the tour's room gets the changed post ('post-updated').
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
        io.to(tourRoom(post.tourId)).emit('post-updated', populated);
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
        io.to(tourRoom(post.tourId)).emit('post-updated', populated);
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
        io.to(tourRoom(post.tourId)).emit('post-updated', populated);
      } catch (err) {
        logger.error(`chat: failed to react to post ${postId}: ${err}`);
        socket.emit('chat-error', 'Could not save the reaction.');
      }
    });
  });
}
