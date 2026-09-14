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
}
