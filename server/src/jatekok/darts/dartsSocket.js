import mongoose from 'mongoose';
import DartsGame from '../../models/dartsGameModel.js';
import logger from '../../logger.js';
import { getIo } from '../../chat/tourEvents.js';

// Móka → Darts, live: one phone keeps the score, the game's other people
// follow it on their own. Whoever has a game on screen is in its channel on
// the app's one Socket.IO connection (see chat/chatSocket.js, and the
// client's TourSocketService). Everything is done over REST
// (dartsController.js); after each change only the news goes out here
// ('darts-game') - each phone then asks for the game itself, as it is for
// them.
export const dartsRoom = (gameId) => `darts:${gameId}`;

export default function registerDartsHandlers(io) {
  io.on('connection', (socket) => {
    // A game is its own people's (whoever started it or plays in it): nobody
    // else gets into its channel. `ack` hears whether they did.
    socket.on('join-darts', async ({ gameId } = {}, ack) => {
      const userId = socket.request.session?.user?.id;
      let mine = false;
      try {
        mine =
          mongoose.isValidObjectId(userId) &&
          mongoose.isValidObjectId(gameId) &&
          !!(await DartsGame.exists({
            _id: gameId,
            $or: [{ createdBy: userId }, { 'players.user': userId }],
          }));
        if (mine) socket.join(dartsRoom(String(gameId)));
      } catch (err) {
        logger.error(`darts: failed to join game ${gameId}: ${err}`);
      }
      if (typeof ack === 'function') ack(mine);
    });

    socket.on('leave-darts', ({ gameId } = {}) => {
      if (gameId) socket.leave(dartsRoom(String(gameId)));
    });
  });
}

// The game was just stored: its people's phones hear of it. `updatedAt`
// tells the phone that made the change that it already has it.
// A no-op without a Socket.IO server (in the tests, in one-off scripts).
export function emitDartsChanged(game) {
  getIo()
    ?.to(dartsRoom(String(game._id)))
    .emit('darts-game', { gameId: String(game._id), updatedAt: game.updatedAt });
}
