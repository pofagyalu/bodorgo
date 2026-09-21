import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface AdminUser {
  _id: string;
  name: string;
  email?: string;
  familyId?: string;
  role: string;
  sub?: string;
  lastLoginAt?: string;
  createdAt: string;
  // birthday is only ever used to pre-fill the edit form - the table shows
  // the computed age instead, never the raw date (see userController.js's
  // computeAge).
  birthday?: string;
  gender?: string;
  age?: number | null;
  // Admin-only, like familyId/role/lastLoginAt above - distinct tour count
  // from Reservation.attendees, not stored on the user (see
  // userController.js's getAllUsers).
  toursAttended?: number;
}

export interface AdminUsersResponse {
  status: string;
  results: number;
  data: {
    users: AdminUser[];
  };
}

export interface AttendedTour {
  _id: string;
  title: string;
  slug: string;
  order: number;
  startDate: string;
  imageCover: string;
}

export interface MyAttendanceResponse {
  status: string;
  data: {
    tours: { tour: AttendedTour; paid: boolean }[];
  };
}

export interface FamilyMember {
  _id: string;
  name: string;
  email?: string;
  role: string;
}

export interface MyFamilyResponse {
  status: string;
  data: {
    members: FamilyMember[];
  };
}

export interface CreateUserPayload {
  name: string;
  email?: string;
  familyId?: string;
  birthday?: string;
  gender?: string;
}

export interface UpdateUserPayload {
  name?: string;
  email?: string;
  // An empty string explicitly removes the user from their family - see
  // userController.js's updateUser.
  familyId?: string;
  // Same "empty string clears it" convention as familyId above.
  birthday?: string;
  gender?: string;
}

export interface AdminUserResponse {
  status: string;
  data: {
    user: AdminUser;
  };
}

export interface JoinFamilyResponse {
  status: string;
  data: {
    users: AdminUser[];
    familyId: string;
  };
}

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/users`;

  getAllUsers(): Observable<AdminUsersResponse> {
    return this.http.get<AdminUsersResponse>(this.apiUrl);
  }

  getMyAttendance(): Observable<MyAttendanceResponse> {
    return this.http.get<MyAttendanceResponse>(`${this.apiUrl}/me/attendance`);
  }

  getMyFamily(): Observable<MyFamilyResponse> {
    return this.http.get<MyFamilyResponse>(`${this.apiUrl}/me/family`);
  }

  createUser(payload: CreateUserPayload): Observable<AdminUserResponse> {
    return this.http.post<AdminUserResponse>(this.apiUrl, payload);
  }

  updateUser(id: string, payload: UpdateUserPayload): Observable<AdminUserResponse> {
    return this.http.patch<AdminUserResponse>(`${this.apiUrl}/${id}`, payload);
  }

  joinFamily(userIds: string[]): Observable<JoinFamilyResponse> {
    return this.http.post<JoinFamilyResponse>(`${this.apiUrl}/join-family`, { userIds });
  }
}
