import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';

// One live connection to the server, shared by everything on the chat page
// for the selected tour: the chat itself (components/feed) and the
// Szobabeosztás panel (pages/chat/room-board). Joining a tour puts this
// connection in that tour's room on the server, which carries both new chat
// posts and "rooms-changed" pushes (see server/src/chat/chatSocket.js and
// tourEvents.js). Stays connected across tour switches - only the joined
// tour changes.
@Injectable({ providedIn: 'root' })
export class TourSocketService {
  private socket: Socket | null = null;
  private joinedTourId: string | null = null;

  private connection(): Socket {
    if (!this.socket) {
      this.socket = io(environment.apiBaseUrl, { withCredentials: true });
      // Re-join on every (re)connect, not just the first one, so a dropped
      // network connection recovers cleanly instead of silently going stale.
      this.socket.on('connect', () => {
        if (this.joinedTourId) this.socket!.emit('join-tour-chat', { tourId: this.joinedTourId });
      });
      // Tell the server when the chat's tab goes to the background (or
      // comes back): someone looking at the chat gets no push notification
      // about it, and coming back counts as having read it (see
      // server/src/chat/chatNotifications.js).
      document.addEventListener('visibilitychange', () => {
        if (this.joinedTourId && this.socket?.connected) {
          this.socket.emit('chat-visible', {
            tourId: this.joinedTourId,
            visible: document.visibilityState === 'visible',
          });
        }
      });
    }
    return this.socket;
  }

  // Switches the connection to this tour (leaving the previous one). The
  // server answers every join with that tour's chat history.
  joinTour(tourId: string) {
    const socket = this.connection();
    if (this.joinedTourId === tourId) {
      if (socket.connected) socket.emit('join-tour-chat', { tourId });
      return;
    }
    if (this.joinedTourId) socket.emit('leave-tour-chat', { tourId: this.joinedTourId });
    this.joinedTourId = tourId;
    if (socket.connected) socket.emit('join-tour-chat', { tourId });
  }

  // Leaving the chat page altogether.
  leaveTour() {
    if (this.joinedTourId && this.socket?.connected) {
      this.socket.emit('leave-tour-chat', { tourId: this.joinedTourId });
    }
    this.joinedTourId = null;
  }

  // Returns the function that removes this listener again.
  on<T>(event: string, handler: (payload: T) => void): () => void {
    const socket = this.connection();
    socket.on(event, handler);
    return () => socket.off(event, handler);
  }

  emit(event: string, payload: unknown) {
    this.connection().emit(event, payload);
  }
}
