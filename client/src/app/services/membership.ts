import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface MemberUser {
  _id: string;
  name: string;
  role: 'admin' | 'member' | 'guest';
  lastLoginAt?: string;
  createdAt: string;
  // Admin-set (see profile.html's "Tag kezdete" column) - undefined until
  // then, in which case the member is treated as eligible for every
  // tracked year (see members.ts's yearState).
  memberSince?: number;
  // Opaque grouping id - used to find "my own family's other club
  // members" for the membership-dues payment (see members.ts's
  // myFamilyClubMembers).
  familyId?: string;
  // Admin-set (see member-edit.ts) - attended in the past, kept for
  // history, just no longer offered as a candidate for a new reservation
  // or schedule-event opt-in (see tour-details.ts). Shown here as a small
  // status tag, same "open-book" visibility as role/lastLoginAt already
  // have on this list.
  retired?: boolean;
  age: number;
  toursAttended: number;
}

interface MembersResponse {
  status: string;
  data: { users: MemberUser[] };
}

@Injectable({ providedIn: 'root' })
export class MembershipService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/membership`;

  getMembers() {
    return this.http.get<MembersResponse>(`${this.apiUrl}/users`);
  }
}
