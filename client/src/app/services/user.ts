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
  username?: string;
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
  // The calendar year this person officially became a club member -
  // admin-set by hand (see profile.html's admin table), undefined until
  // then. Drives the Klub "Felhasználók" page's per-year membership table.
  memberSince?: number;
  // Admin-only, like familyId/role/lastLoginAt above - distinct tour count
  // from Reservation.attendees, not stored on the user (see
  // userController.js's getAllUsers).
  toursAttended?: number;
  // Admin-set (see member-edit.ts) - someone who attended in the past but
  // is done for good, kept for history everywhere except one thing: an
  // admin building a new reservation or schedule-event opt-in list won't
  // see them offered as a candidate any more (see tour-details.ts's
  // pickerOptions/myScheduleEventCandidates).
  retired?: boolean;
  // When the profile photo last changed (null/absent = no photo) - also
  // the cache-busting version in its URL (see UserService.photoUrl).
  photoUpdatedAt?: string | null;
  // Who last set/removed the photo - once 'self', an admin can no longer
  // change it (see userPhotoController.js).
  photoSetBy?: 'admin' | 'self' | null;
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
  duration?: number;
  coverUpdatedAt?: string;
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
  photoUpdatedAt?: string | null;
}

export interface MyFamilyResponse {
  status: string;
  data: {
    members: FamilyMember[];
  };
}

// GET /users/me's own fixed field set for the Klub "Profilom" self-view -
// deliberately never includes gender/familyId, even about yourself (see
// userController.js's getMe).
export interface MyProfile {
  _id: string;
  name: string;
  username?: string;
  email?: string;
  age: number | null;
  memberSince?: number;
  lastLoginAt?: string;
  toursAttended: number;
  wantsEmailNotifications: boolean;
  address?: UserAddress;
  photoUpdatedAt: string | null;
  photoSetBy: 'admin' | 'self' | null;
}

export interface PhotoResponse {
  status: string;
  data: { photoUpdatedAt: string | null; photoSetBy: 'admin' | 'self' | null };
}

export interface MyProfileResponse {
  status: string;
  data: MyProfile;
}

export interface CreateUserPayload {
  name: string;
  email?: string;
  familyId?: string;
  birthday?: string;
  gender?: string;
  memberSince?: number | null;
  // Same as UpdateUserPayload's own fields below - member-edit.ts/html
  // uses one identical form for creating a brand new person and editing an
  // existing one, so creation accepts everything editing does too.
  address?: UserAddress;
  role?: string;
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
  // null explicitly clears it - see userController.js's parseMemberSince.
  memberSince?: number | null;
  // Manual override, not permanent - the next real Authentik login
  // overwrites it again (see userController.js's updateUser).
  role?: string;
  // An admin may set it; '' clears it. The user can still change it.
  username?: string;
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
  // name/email are NOT self-editable - name comes from Authentik, email
  // is admin-only (see UpdateUserPayload) - only username is the user's
  // own to change (see userController.js's updateMe).
  username?: string;
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

  // Only ever loaded by a logged-in browser (the session cookie goes along
  // with the <img> request - bodorgo.hu and api.bodorgo.hu are the same
  // site). ?v= changes with every new upload, so the old one can be
  // cached forever.
  photoUrl(userId: string, version: string): string {
    return `${this.apiUrl}/${userId}/photo?v=${encodeURIComponent(version)}`;
  }

  // userId null = the logged-in user's own photo.
  uploadPhoto(userId: string | null, photo: Blob): Observable<PhotoResponse> {
    const body = new FormData();
    body.append('file', photo, 'photo.jpg');
    return this.http.put<PhotoResponse>(`${this.apiUrl}/${userId ?? 'me'}/photo`, body);
  }

  deletePhoto(userId: string | null): Observable<PhotoResponse> {
    return this.http.delete<PhotoResponse>(`${this.apiUrl}/${userId ?? 'me'}/photo`);
  }

  getAllUsers(): Observable<AdminUsersResponse> {
    return this.http.get<AdminUsersResponse>(this.apiUrl);
  }

  // Admin-only (see userRoutes.js) - one specific user's full editable
  // record, for the Klub Felhasználók "Szerkesztés" page.
  getUser(id: string): Observable<AdminUserResponse> {
    return this.http.get<AdminUserResponse>(`${this.apiUrl}/${id}`);
  }

  getMyAttendance(): Observable<MyAttendanceResponse> {
    return this.http.get<MyAttendanceResponse>(`${this.apiUrl}/me/attendance`);
  }

  getMyFamily(): Observable<MyFamilyResponse> {
    return this.http.get<MyFamilyResponse>(`${this.apiUrl}/me/family`);
  }

  getMe(): Observable<MyProfileResponse> {
    return this.http.get<MyProfileResponse>(`${this.apiUrl}/me`);
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

  // Never actually deletes - marks the user retired, reversible via
  // restoreUser (see userController.js's archiveUser).
  archiveUser(id: string): Observable<unknown> {
    return this.http.delete(`${this.apiUrl}/${id}`);
  }

  restoreUser(id: string): Observable<unknown> {
    return this.http.patch(`${this.apiUrl}/${id}/restore`, {});
  }

  joinFamily(userIds: string[]): Observable<JoinFamilyResponse> {
    return this.http.post<JoinFamilyResponse>(`${this.apiUrl}/join-family`, { userIds });
  }

  // Admin-only: everyone's usernames, for filling them in at once (Klub →
  // Beállítások). Saving is all-or-nothing; a failed save's `errors` maps
  // user ids to what's wrong with that row.
  getUsernames() {
    return this.http.get<{ data: { users: { _id: string; name: string; username?: string; role: string }[] } }>(
      `${this.apiUrl}/usernames`,
    );
  }

  updateUsernames(items: { id: string; username: string }[]) {
    return this.http.put<{ data: { updated: number } }>(`${this.apiUrl}/usernames`, { items });
  }
}
