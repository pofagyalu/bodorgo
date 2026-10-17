// Lets REST controllers push a live event to everyone who has a tour's
// chat page open, or a chat room open - two kinds of Socket.IO channels
// (see chatSocket.js): a tour's (join-tour: its Szobabeosztás) and a chat
// room's (join-chat: its messages and polls). Set once at startup by
// registerChatHandlers; a no-op before that (e.g. in one-off scripts).
let ioInstance = null;

export const tourRoom = (tourId) => `tour:${tourId}`;
export const chatChannel = (chatRoomId) => `chat:${chatRoomId}`;

export function setIo(io) {
  ioInstance = io;
}

// The Socket.IO server itself - for what needs more than a room broadcast
// (e.g. chatNotifications.js's check of who's looking at a chat).
export const getIo = () => ioInstance;

// A session ended (logout, logged out everywhere, suspended - see
// utils/appSessions.js): its open chat connections are cut too, or a tab
// left open would go on reading and writing as them. Cut by the server,
// the client doesn't connect again by itself. How many were cut.
export async function disconnectSessions(sessionIds) {
  if (!ioInstance || !sessionIds?.length) return 0;
  const ended = new Set(sessionIds.map(String));
  let cut = 0;
  for (const socket of await ioInstance.fetchSockets()) {
    if (socket.data.sessionId && ended.has(socket.data.sessionId)) {
      socket.disconnect(true);
      cut += 1;
    }
  }
  return cut;
}

export function emitToTour(tourId, event, payload) {
  ioInstance?.to(tourRoom(String(tourId))).emit(event, payload);
}

export function emitToChatRoom(chatRoomId, event, payload) {
  ioInstance?.to(chatChannel(String(chatRoomId))).emit(event, payload);
}
