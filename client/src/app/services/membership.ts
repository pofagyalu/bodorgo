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
