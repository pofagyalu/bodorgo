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

export function emitToTour(tourId, event, payload) {
  ioInstance?.to(tourRoom(String(tourId))).emit(event, payload);
}

export function emitToChatRoom(chatRoomId, event, payload) {
  ioInstance?.to(chatChannel(String(chatRoomId))).emit(event, payload);
}
