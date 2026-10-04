import { getIo } from '../../chat/tourEvents.js';

// Móka → Kvíz, live: everyone with a game on screen (the host and the
// players alike) is in the game's channel on the app's one Socket.IO
// connection (see chat/chatSocket.js, and the client's TourSocketService).
// Everything is done over REST (quizController.js); after each change the
// game as it now stands goes out here ('quiz-game').
export const quizRoom = (gameId) => `quiz:${gameId}`;

export default function registerQuizHandlers(io) {
  io.on('connection', (socket) => {
    socket.on('join-quiz', ({ gameId } = {}) => {
      if (!socket.request.session?.user || !gameId) return;
      socket.join(quizRoom(String(gameId)));
    });

    socket.on('leave-quiz', ({ gameId } = {}) => {
      if (gameId) socket.leave(quizRoom(String(gameId)));
    });
  });
}

// A no-op without a Socket.IO server (in the tests, in one-off scripts).
export function emitToQuiz(gameId, event, payload) {
  getIo()
    ?.to(quizRoom(String(gameId)))
    .emit(event, payload);
}
