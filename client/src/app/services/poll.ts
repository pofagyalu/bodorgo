import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';

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
  tour: PollTourRef;
  question: string;
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
  data: { poll: Poll };
}

// Shape for createPoll, createTourPoll and updatePoll - a partial on
// update, since an admin editing a poll that already has votes may only be
// allowed to touch tour/closesAt (see updatePoll's own server-side lock).
// minimumCount applies to the first answer; null removes it.
export interface PollPayload {
  tour?: string;
  question?: string;
  options?: string[];
  closesAt?: string;
  visibility?: PollVisibility;
  minimumCount?: number | null;
}

@Injectable({ providedIn: 'root' })
export class PollService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/polls`;

  // How many open polls on my tours still wait for my vote - the
  // Szavazások menu's badge. Refreshed on page changes (see header.ts) and
  // after anything that changes it here.
  readonly pendingCount = signal(0);

  refreshPending() {
    this.http.get<{ data: { count: number } }>(`${this.apiUrl}/pending`).subscribe({
      next: (res) => this.pendingCount.set(res.data.count),
      error: () => {},
    });
  }

  getPolls(): Observable<PollsResponse> {
    return this.http.get<PollsResponse>(this.apiUrl);
  }

  getPoll(id: string): Observable<PollResponse> {
    return this.http.get<PollResponse>(`${this.apiUrl}/${id}`);
  }

  createPoll(payload: PollPayload): Observable<PollResponse> {
    return this.http.post<PollResponse>(this.apiUrl, payload).pipe(tap(() => this.refreshPending()));
  }

  // From a tour's chat - by anyone signed up for the tour.
  createTourPoll(tourId: string, payload: PollPayload): Observable<PollResponse> {
    return this.http
      .post<PollResponse>(`${environment.apiBaseUrl}/tours/${tourId}/polls`, payload)
      .pipe(tap(() => this.refreshPending()));
  }

  updatePoll(id: string, payload: PollPayload): Observable<PollResponse> {
    return this.http.patch<PollResponse>(`${this.apiUrl}/${id}`, payload);
  }

  closePoll(id: string): Observable<PollResponse> {
    return this.http.post<PollResponse>(`${this.apiUrl}/${id}/close`, {}).pipe(tap(() => this.refreshPending()));
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
