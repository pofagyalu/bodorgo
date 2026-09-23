import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// Structured rather than one free-text field specifically so `city` can
// be used on its own for the "X-tól/-től" ("from X") wording on the tour
// page/PDF (see server's hungarianGrammar.js). country defaults to
// "Magyarország" server-side when left blank.
export interface UserAddress {
  zipCode?: string;
  city?: string;
  street?: string;
  country?: string;
}

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
  address?: UserAddress;
  // Geocoded from `address` server-side - present only once a real
  // address has been successfully located (see userModel.js's
  // pre('save') hook). Used to compute tour distance/duration from this
  // person's own home instead of Budapest.
  location?: { lat: number; lng: number };
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
    // paymentId/paymentMethod are only ever set when paid is true AND it
    // was actually paid through a payment this app tracked (Stripe or an
    // admin's cash entry) - a lot of real paid=true data predates that
    // (imported historical attendance, or the "0% advance" auto-mark),
    // which has no such record at all. method 'stripe' has a real receipt
    // to download; 'cash' doesn't (see paymentController.js).
    tours: {
      tour: AttendedTour;
      paid: boolean;
      paymentId: string | null;
      paymentMethod: 'stripe' | 'cash' | null;
    }[];
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
  address?: UserAddress;
}

export interface AdminUserResponse {
  status: string;
  data: {
    user: AdminUser;
    // null when there's no address to resolve (no city set at all),
    // otherwise whether it actually geocoded - see userController.js's
    // updateMe/updateUser. Lets the UI tell the person outright whether
    // their new address was actually located, rather than them only
    // noticing later when a tour's distance quietly never changes.
    addressResolved?: boolean | null;
  };
}

export interface UpdateMePayload {
  name?: string;
  email?: string;
  wantsEmailNotifications?: boolean;
  address?: UserAddress;
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

  updateMe(payload: UpdateMePayload): Observable<AdminUserResponse> {
    return this.http.patch<AdminUserResponse>(`${this.apiUrl}/updateMe`, payload);
  }

  joinFamily(userIds: string[]): Observable<JoinFamilyResponse> {
    return this.http.post<JoinFamilyResponse>(`${this.apiUrl}/join-family`, { userIds });
  }
}
