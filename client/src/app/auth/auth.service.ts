import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap, catchError, of } from 'rxjs';
import { environment } from '../../environments/environment';
import { UserAddress } from '../services/user';

export interface CurrentUser {
  id: string;
  email?: string;
  name?: string;
  role: string;
  // The one admin who may change roles (server utils/roleManager.js).
  canManageRoles?: boolean;
  familyId?: string;
  wantsEmailNotifications?: boolean;
  address?: UserAddress;
  // Profile photo version (null = none) - the header's avatar; kept in
  // sync after an upload via patchCurrentUser.
  photoUpdatedAt?: string | null;
}

interface MeResponse {
  loggedIn: boolean;
  id?: string;
  sub?: string;
  email?: string;
  name?: string;
  role?: string;
  canManageRoles?: boolean;
  familyId?: string;
  wantsEmailNotifications?: boolean;
  address?: UserAddress;
  photoUpdatedAt?: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private http = inject(HttpClient);

  private loggedIn = signal(false);
  private currentUser = signal<CurrentUser | null>(null);

  isLoggedIn = this.loggedIn.asReadonly();
  user = this.currentUser.asReadonly();

  // Lets a component (e.g. the profile page's notification toggle) reflect
  // a just-saved change immediately, without a full /auth/me round trip.
  patchCurrentUser(patch: Partial<CurrentUser>) {
    const current = this.currentUser();
    if (current) {
      this.currentUser.set({ ...current, ...patch });
    }
  }

  // Full-page navigation: the server responds with a redirect to Authentik,
  // which only makes sense as a top-level browser navigation, not an XHR call.
  login() {
    window.location.href = `${environment.apiBaseUrl}/auth/login`;
  }

  // Which login the page shows: with LOCAL_LOGIN=true on the server an
  // e-mail and password form, otherwise the way to the OIDC provider (also
  // when the question itself fails).
  loginMode() {
    return this.http
      .get<{ localLogin: boolean }>(`${environment.apiBaseUrl}/auth/mode`)
      .pipe(catchError(() => of({ localLogin: false })));
  }

  // E-mail and password (server authOidcController.js's localLogin) - the
  // session cookie comes with the answer.
  localLogin(email: string, password: string) {
    return this.http.post<{ status: string }>(
      `${environment.apiBaseUrl}/auth/local-login`,
      { email, password },
      { withCredentials: true },
    );
  }

  // Same as login(): the server redirects on to Authentik's end-session page.
  logout() {
    window.location.href = `${environment.apiBaseUrl}/auth/logout`;
  }

  checkAuth() {
    return this.http
      .get<MeResponse>(`${environment.apiBaseUrl}/auth/me`, {
        withCredentials: true,
      })
      .pipe(
        tap((res) => {
          this.loggedIn.set(!!res.loggedIn);
          this.currentUser.set(
            res.loggedIn
              ? {
                  id: res.id!,
                  email: res.email,
                  name: res.name,
                  // 'guest' is the safe default: see userModel.js, 'member'
                  // is dues-paying membership, never assumed just because a
                  // role wasn't returned.
                  role: res.role || 'guest',
                  canManageRoles: !!res.canManageRoles,
                  familyId: res.familyId,
                  // Same default as the schema (userModel.js) - only ever
                  // false when explicitly turned off.
                  wantsEmailNotifications: res.wantsEmailNotifications !== false,
                  address: res.address,
                  photoUpdatedAt: res.photoUpdatedAt ?? null,
                }
              : null,
          );
        }),
        catchError(() => {
          this.loggedIn.set(false);
          this.currentUser.set(null);
          return of({ loggedIn: false } as MeResponse);
        }),
      );
  }
}
