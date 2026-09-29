import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';

// One live connection to the server, shared by everything on the chat page.
// It can be in two kinds of channels at once (see server
// src/chat/chatSocket.js):
// - a tour's (joinTour): its Szobabeosztás changes ("rooms-changed", for
//   pages/chat/room-board);
// - a chat room's (joinChat): its messages, reactions and polls (for
//   components/feed) - the general Kotyogó or a tour's.
// Stays connected across switches - only the joined tour / room changes.
@Injectable({ providedIn: 'root' })
export class TourSocketService {
  private socket: Socket | null = null;
  private joinedTourId: string | null = null;
  private joinedChatRoomId: string | null = null;

  private connection(): Socket {
    if (!this.socket) {
      this.socket = io(environment.apiBaseUrl, { withCredentials: true });
      // Re-join on every (re)connect, not just the first one, so a dropped
      // network connection recovers cleanly instead of silently going stale.
      this.socket.on('connect', () => {
        if (this.joinedTourId) this.socket!.emit('join-tour', { tourId: this.joinedTourId });
        if (this.joinedChatRoomId) {
          this.socket!.emit('join-chat', { chatRoomId: this.joinedChatRoomId });
        }
      });
      // Tell the server when the chat's tab goes to the background (or
      // comes back): someone looking at the chat gets no push notification
      // about it, and coming back counts as having read it (see
      // server/src/chat/chatNotifications.js).
      document.addEventListener('visibilitychange', () => {
        if (this.joinedChatRoomId && this.socket?.connected) {
          this.socket.emit('chat-visible', {
            chatRoomId: this.joinedChatRoomId,
            visible: document.visibilityState === 'visible',
          });
        }
      });
    }
    return this.socket;
  }

  // --- A tour's channel (Szobabeosztás) ---

  joinTour(tourId: string) {
    const socket = this.connection();
    if (this.joinedTourId === tourId) return;
    if (this.joinedTourId && socket.connected) {
      socket.emit('leave-tour', { tourId: this.joinedTourId });
    }
    this.joinedTourId = tourId;
    if (socket.connected) socket.emit('join-tour', { tourId });
  }

  leaveTour() {
    if (this.joinedTourId && this.socket?.connected) {
      this.socket.emit('leave-tour', { tourId: this.joinedTourId });
    }
    this.joinedTourId = null;
  }

  // --- A chat room's channel ---

  // Switches the connection to this room (leaving the previous one). The
  // server answers every join with the room's history ('initial-posts').
  joinChat(chatRoomId: string) {
    const socket = this.connection();
    if (this.joinedChatRoomId === chatRoomId) {
      if (socket.connected) socket.emit('join-chat', { chatRoomId });
      return;
    }
    if (this.joinedChatRoomId && socket.connected) {
      socket.emit('leave-chat', { chatRoomId: this.joinedChatRoomId });
    }
    this.joinedChatRoomId = chatRoomId;
    if (socket.connected) socket.emit('join-chat', { chatRoomId });
  }

  // Only if it's still this room - a feed closing after the next one
  // already joined must not take that one back.
  leaveChat(chatRoomId: string) {
    if (this.joinedChatRoomId !== chatRoomId) return;
    if (this.socket?.connected) {
      this.socket.emit('leave-chat', { chatRoomId: this.joinedChatRoomId });
    }
    this.joinedChatRoomId = null;
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
