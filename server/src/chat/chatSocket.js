import Post from '../models/postModel.js';
import logger from '../logger.js';
import { setIo, tourRoom } from './tourEvents.js';
import { markChatRead, notifyChatPostInBackground } from './chatNotifications.js';

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
      sessionUser && markChatRead(sessionUser.id, tourId).catch((err) => logger.error(`chat: mark read failed: ${err}`));

    socket.on('join-tour-chat', async ({ tourId }) => {
      if (!sessionUser) {
        return socket.emit('chat-error', 'Not authenticated. Please login.');
      }
      if (!tourId) return;

      socket.join(tourRoom(tourId));
      socket.data.visibleTour = String(tourId);
      markRead(tourId);

      try {
        const posts = await Post.find({ tourId })
          .sort('createdAt')
          .populate('creator', 'name username');
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
        const populated = await post.populate('creator', 'name username');
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
        const populated = await post.populate('creator', 'name username');
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
        post.image = null;
        post.deletedAt = new Date();
        await post.save();
        const populated = await post.populate('creator', 'name username');
        io.to(tourRoom(post.tourId)).emit('post-updated', populated);
      } catch (err) {
        logger.error(`chat: failed to delete post ${postId}: ${err}`);
        socket.emit('chat-error', 'Could not delete message.');
      }
    });
  });
}
