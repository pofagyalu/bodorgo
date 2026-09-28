// Lets REST controllers push a live event to everyone who has a tour's
// chat page open - they're all in that tour's Socket.IO room (see
// chatSocket.js's join-tour-chat). Set once at startup by
// registerChatHandlers; a no-op before that (e.g. in one-off scripts).
let ioInstance = null;

export const tourRoom = (tourId) => `tour:${tourId}`;

export function setIo(io) {
  ioInstance = io;
}

// The Socket.IO server itself - for what needs more than a room broadcast
// (e.g. chatNotifications.js's check of who's looking at a chat).
export const getIo = () => ioInstance;

export function emitToTour(tourId, event, payload) {
  ioInstance?.to(tourRoom(String(tourId))).emit(event, payload);
}
