import Post from '../models/postModel.js';
import logger from '../logger.js';

const room = (tourId) => `tour:${tourId}`;

export default function registerChatHandlers(io) {
  io.on('connection', (socket) => {
    const sessionUser = socket.request.session?.user;

    socket.on('join-tour-chat', async ({ tourId }) => {
      if (!sessionUser) {
        return socket.emit('chat-error', 'Not authenticated. Please login.');
      }
      if (!tourId) return;

      socket.join(room(tourId));

      try {
        const posts = await Post.find({ tourId })
          .sort('createdAt')
          .populate('creator', 'name');
        socket.emit('initial-posts', posts);
      } catch (err) {
        logger.error(`chat: failed to load posts for tour ${tourId}: ${err}`);
        socket.emit('chat-error', 'Could not load chat history.');
      }
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
        io.to(room(tourId)).emit('new-post', populated);
      } catch (err) {
        logger.error(`chat: failed to save post for tour ${tourId}: ${err}`);
        socket.emit('chat-error', 'Could not send message.');
      }
    });
  });
}
