import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface PollOption {
  _id: string;
  text: string;
}

// count/percentage only ever present once the viewer has earned seeing
// them (voted, or the poll has closed) - see pollController.js's
// buildPollView. Never who voted for what, just aggregate counts.
export interface PollResultOption extends PollOption {
  count: number;
  percentage: number;
}

export interface PollTourRef {
  _id: string;
  title: string;
  slug: string;
  order: number;
}

export interface Poll {
  _id: string;
  tour: PollTourRef;
  question: string;
  options: PollOption[];
  closesAt: string;
  isClosed: boolean;
  hasVoted: boolean;
  myOptionId: string | null;
  // null until hasVoted or isClosed - see PollResultOption's own comment.
  totalVotes: number | null;
  results: PollResultOption[] | null;
  createdAt: string;
}

export interface PollsResponse {
  status: string;
  data: { polls: Poll[] };
}

export interface PollResponse {
  status: string;
  data: { poll: Poll };
}

// Shape for both createPoll and updatePoll - a partial on update, since an
// admin editing a poll that already has votes may only be allowed to touch
// tour/closesAt (see updatePoll's own server-side lock).
export interface PollPayload {
  tour?: string;
  question?: string;
  options?: string[];
  closesAt?: string;
}

@Injectable({ providedIn: 'root' })
export class PollService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/polls`;

  getPolls(): Observable<PollsResponse> {
    return this.http.get<PollsResponse>(this.apiUrl);
  }

  getPoll(id: string): Observable<PollResponse> {
    return this.http.get<PollResponse>(`${this.apiUrl}/${id}`);
  }

  createPoll(payload: PollPayload): Observable<PollResponse> {
    return this.http.post<PollResponse>(this.apiUrl, payload);
  }

  updatePoll(id: string, payload: PollPayload): Observable<PollResponse> {
    return this.http.patch<PollResponse>(`${this.apiUrl}/${id}`, payload);
  }

  deletePoll(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  vote(id: string, optionId: string): Observable<PollResponse> {
    return this.http.post<PollResponse>(`${this.apiUrl}/${id}/vote`, { optionId });
  }
}
