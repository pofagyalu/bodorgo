import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { PushService } from './push';

export interface PollOption {
  _id: string;
  text: string;
}

// count/percentage only present once the viewer may see them - always for
// an open ('Nyílt') poll, for a secret one after voting or once it closed
// (see pollController.js's buildPollView). voters: open polls only.
export interface PollResultOption extends PollOption {
  count: number;
  percentage: number;
  voters?: { _id: string; name: string }[];
}

export interface PollTourRef {
  _id: string;
  title: string;
  slug: string;
  order: number;
}

export type PollVisibility = 'open' | 'secret';

export interface Poll {
  _id: string;
  tour: PollTourRef | null; // null: a general poll (the general Kotyogó)
  question: string;
  // Rád vár: open, not voted, and mine to vote on (my tour's, or a general
  // poll) - what the Voks badge counts.
  awaitsMyVote: boolean;
  // Részletek - formatted HTML under the question (cleaned by the server); '' if none.
  details: string;
  options: PollOption[];
  closesAt: string;
  isClosed: boolean;
  hasVoted: boolean;
  myOptionId: string | null;
  visibility: PollVisibility;
  // "At least N on the first answer" (e.g. 5 for the museum to open).
  minimum: { optionId: string; count: number; current: number; reached: boolean } | null;
  // The chat message it was started from, if it was.
  post: string | null;
  createdBy: { _id: string; name: string } | null;
  // Started it, or an admin: may close or delete it.
  canManage: boolean;
  // null until the viewer may see results - see PollResultOption.
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
  // emailCount: a new poll from Voks - how many got the e-mail about it.
  data: { poll: Poll; emailCount?: number };
}

// A club member on the new poll's e-mail list (Voks): the ones who can't
// get it say why.
export interface PollEmailMember {
  _id: string;
  name: string;
  canEmail: boolean;
  reason: string | null;
}

// Shape for createPoll, createTourPoll and updatePoll - a partial on
// update, since an admin editing a poll that already has votes may only be
// allowed to touch tour/closesAt (see updatePoll's own server-side lock).
// minimumCount applies to the first answer; null removes it.
export interface PollPayload {
  tour?: string;
  question?: string;
  details?: string;
  options?: string[];
  closesAt?: string;
  visibility?: PollVisibility;
  minimumCount?: number | null;
  // createPoll only: club members to e-mail about the new poll.
  emailTo?: string[];
}

@Injectable({ providedIn: 'root' })
export class PollService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/polls`;

  // How many open polls on my tours still wait for my vote - the
  // Voks menu's badge. Refreshed on page changes (see header.ts) and
  // after anything that changes it here.
  readonly pendingCount = signal(0);
  private push = inject(PushService);

  refreshPending() {
    this.http.get<{ data: { count: number } }>(`${this.apiUrl}/pending`).subscribe({
      next: (res) => {
        this.pendingCount.set(res.data.count);
        // No poll waits for me: none needs a notification on the phone
        // either (their tags: server controllers/pollController.js).
        if (!res.data.count) this.push.closeNotifications((tag) => tag.startsWith('poll-'));
      },
      error: () => {},
    });
  }

  getPolls(): Observable<PollsResponse> {
    return this.http.get<PollsResponse>(this.apiUrl);
  }

  getPoll(id: string): Observable<PollResponse> {
    return this.http.get<PollResponse>(`${this.apiUrl}/${id}`);
  }

  // Admin only: who the new poll's e-mail can go to.
  getEmailRecipients(): Observable<{ data: { members: PollEmailMember[] } }> {
    return this.http.get<{ data: { members: PollEmailMember[] } }>(
      `${this.apiUrl}/email-recipients`,
    );
  }

  createPoll(payload: PollPayload): Observable<PollResponse> {
    return this.http
      .post<PollResponse>(this.apiUrl, payload)
      .pipe(tap(() => this.refreshPending()));
  }

  // From a tour's chat - by anyone signed up for the tour.
  createTourPoll(tourId: string, payload: PollPayload): Observable<PollResponse> {
    return this.http
      .post<PollResponse>(`${environment.apiBaseUrl}/tours/${tourId}/polls`, payload)
      .pipe(tap(() => this.refreshPending()));
  }

  // From the general Kotyogó - by anyone logged in; a poll without a tour.
  createGeneralPoll(payload: PollPayload): Observable<PollResponse> {
    return this.http
      .post<PollResponse>(`${environment.apiBaseUrl}/chat-rooms/general/polls`, payload)
      .pipe(tap(() => this.refreshPending()));
  }

  updatePoll(id: string, payload: PollPayload): Observable<PollResponse> {
    return this.http.patch<PollResponse>(`${this.apiUrl}/${id}`, payload);
  }

  closePoll(id: string): Observable<PollResponse> {
    return this.http
      .post<PollResponse>(`${this.apiUrl}/${id}/close`, {})
      .pipe(tap(() => this.refreshPending()));
  }

  deletePoll(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`).pipe(tap(() => this.refreshPending()));
  }

  // Voting again changes the vote.
  vote(id: string, optionId: string): Observable<PollResponse> {
    return this.http
      .post<PollResponse>(`${this.apiUrl}/${id}/vote`, { optionId })
      .pipe(tap(() => this.refreshPending()));
  }
}
