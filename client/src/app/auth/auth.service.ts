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

// Profilom → Bejelentkezések (server GET /auth/sessions): where I am
// logged in - in Bódorgó itself, and the devices Authentik remembers.
export interface AppLoginSession {
  id: string;
  current: boolean;
  device: string | null;
  ip: string | null;
  loginAt: string | null;
  lastActiveAt: string | null;
  expiresAt: string | null;
}

export interface AuthentikLoginSession {
  id: string;
  device: string | null;
  ip: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  // How many Authentik records the row stands for (it keeps the old one at
  // each new login); the times are the newest one's.
  count: number;
}

export interface LoginSessions {
  here: { device: string | null; ip: string };
  app: AppLoginSession[];
  // null: the app has no Authentik API token (or Authentik did not answer).
  authentik: AuthentikLoginSession[] | null;
  authentikError: string | null;
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
  freshLoginSecondsLeft?: number;
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

  // The server itself said nobody is logged in - not merely that it
  // couldn't be asked. What is kept on the device for the one logged in
  // (the songbook's offline copy) goes then.
  private saidLoggedOut = signal(false);
  loggedOut = this.saidLoggedOut.asReadonly();

  // Until when sensitive operations go without identifying again (see
  // fresh-login.service.ts) - on this device's clock, from the seconds the
  // server said were left. 0: they ask first.
  private freshLoginUntil = signal(0);
  hasFreshLogin() {
    return Date.now() < this.freshLoginUntil();
  }
  // The server refused one after all (the ten minutes ran out meanwhile).
  freshLoginGone() {
    this.freshLoginUntil.set(0);
  }

  // Full-page navigation, like login(): the provider asks who they are even
  // if its own session is still alive, then the server brings them back to
  // this page of the app (its path, as the router has it).
  identifyAgain(returnTo: string) {
    window.location.href = `${environment.apiBaseUrl}/auth/login?stepup=1&returnTo=${encodeURIComponent(returnTo)}`;
  }

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

  loginSessions() {
    return this.http.get<{ data: LoginSessions }>(`${environment.apiBaseUrl}/auth/sessions`);
  }

  // Every other browser of mine out of the app, and Authentik forgets all
  // my devices; this one stays logged in.
  logoutOtherSessions() {
    return this.http.post<{ data: { appEnded: number; authentikEnded: number | null } }>(
      `${environment.apiBaseUrl}/auth/sessions/logout-others`,
      {},
    );
  }

  checkAuth() {
    return this.http
      .get<MeResponse>(`${environment.apiBaseUrl}/auth/me`, {
        withCredentials: true,
      })
      .pipe(
        tap((res) => {
          this.loggedIn.set(!!res.loggedIn);
          this.saidLoggedOut.set(!res.loggedIn);
          const freshSeconds = res.loggedIn ? (res.freshLoginSecondsLeft ?? 0) : 0;
          this.freshLoginUntil.set(freshSeconds > 0 ? Date.now() + freshSeconds * 1000 : 0);
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
          this.freshLoginUntil.set(0);
          return of({ loggedIn: false } as MeResponse);
        }),
      );
  }
}
