import Post from '../models/postModel.js';
import logger from '../logger.js';
import { setIo, tourRoom } from './tourEvents.js';

// One Socket.IO connection per open browser tab, shared by the tour chat
// and its Szobabeosztás panel (see the client's TourSocketService): joining
// a tour puts the socket in that tour's room, which carries both new chat
// posts and "rooms-changed" pushes (see tourEvents.js's emitToTour).
export default function registerChatHandlers(io) {
  setIo(io);

  io.on('connection', (socket) => {
    const sessionUser = socket.request.session?.user;

    socket.on('join-tour-chat', async ({ tourId }) => {
      if (!sessionUser) {
        return socket.emit('chat-error', 'Not authenticated. Please login.');
      }
      if (!tourId) return;

      socket.join(tourRoom(tourId));

      try {
        const posts = await Post.find({ tourId })
          .sort('createdAt')
          .populate('creator', 'name');
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
        const populated = await post.populate('creator', 'name');
        io.to(tourRoom(tourId)).emit('new-post', populated);
      } catch (err) {
        logger.error(`chat: failed to save post for tour ${tourId}: ${err}`);
        socket.emit('chat-error', 'Could not send message.');
      }
    });
  });
}
