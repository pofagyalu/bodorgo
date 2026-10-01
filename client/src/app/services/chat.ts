import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

// A Kotyogó chat room (see server models/chatRoomModel.js): the one general
// room, or a tour's own. Every message belongs to a room; its _id is what
// the chat's socket events use (see TourSocketService).
export interface ChatRoom {
  _id: string;
  type: 'general' | 'tour';
  tourId: string | null;
}

// A room in the list of Kotyogós (GET /chat-rooms/overview): its last
// message, how many I haven't seen, how many people it has.
export interface ChatRoomSummary {
  chatRoomId: string | null; // null: a tour's room nobody has opened yet
  lastPost: {
    author: string;
    text: string; // shortened
    hasImage: boolean;
    isPoll: boolean;
    createdAt: string;
  } | null;
  unread: number;
  memberCount: number;
}

export interface ChatOverview {
  general: ChatRoomSummary;
  // past: the tour is over (by more than two weeks) - its chat is listed
  // among the archives; closed: it's read-only too (every past one but the
  // test tour's).
  tours: (ChatRoomSummary & { tourId: string; past: boolean; closed: boolean })[];
}

// The launch game's podium (GET /chat-rooms/general/game, and the socket's
// 'chat-game'): "the first three to write in Bódorgók" - see the server's
// chat/firstWritersGame.js.
export interface ChatGame {
  startedAt: string;
  finishedAt: string | null;
  places: number;
  winners: {
    place: 1 | 2 | 3;
    userId: string;
    name: string;
    username: string | null;
    photoUpdatedAt: string | null;
    at: string;
  }[];
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/chat-rooms`;

  // Every room for the list: last message, unread count, people.
  getOverview() {
    return this.http.get<{ data: ChatOverview }>(`${this.apiUrl}/overview`);
  }

  // A tour's own room - made on first use.
  getTourChatRoom(tourId: string) {
    return this.http.get<{ data: { chatRoom: ChatRoom } }>(
      `${environment.apiBaseUrl}/tours/${tourId}/chat-room`,
    );
  }

  // The club-wide room - made on first use.
  getGeneralChatRoom() {
    return this.http.get<{ data: { chatRoom: ChatRoom } }>(`${this.apiUrl}/general`);
  }

  // The launch game's podium - null when there's nothing to show.
  getGeneralGame() {
    return this.http.get<{ data: { game: ChatGame | null } }>(`${this.apiUrl}/general/game`);
  }

  // Who can be "@"-mentioned in the general room - everyone with a
  // username.
  getGeneralPeople() {
    return this.http.get<{
      data: { people: { userId: string; name: string; username: string }[] };
    }>(`${this.apiUrl}/general/people`);
  }

  // A photo sent in a room (see server chatImageController.js). The photo
  // addresses are plain URLs for <img> - auth rides on the session cookie.
  sendChatImage(chatRoomId: string, image: Blob, text: string) {
    const form = new FormData();
    form.append('image', image, 'foto.jpg');
    form.append('text', text);
    return this.http.post(`${this.apiUrl}/${chatRoomId}/images`, form);
  }

  chatImageUrl(chatRoomId: string, postId: string): string {
    return `${this.apiUrl}/${chatRoomId}/images/${postId}`;
  }

  chatImageThumbUrl(chatRoomId: string, postId: string): string {
    return `${this.chatImageUrl(chatRoomId, postId)}/thumb`;
  }
}
