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

@Injectable({ providedIn: 'root' })
export class ChatService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/chat-rooms`;

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
