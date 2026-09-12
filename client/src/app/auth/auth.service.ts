import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap, catchError, of } from 'rxjs';
import { environment } from '../../environments/environment';

export interface CurrentUser {
  id: string;
  email?: string;
  name?: string;
  role: string;
}

interface MeResponse {
  loggedIn: boolean;
  sub?: string;
  email?: string;
  name?: string;
  role?: string;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private loggedIn = signal(false);
  private currentUser = signal<CurrentUser | null>(null);

  isLoggedIn = this.loggedIn.asReadonly();
  user = this.currentUser.asReadonly();

  constructor(private http: HttpClient) {}

  // Full-page navigation: the server responds with a redirect to Authentik,
  // which only makes sense as a top-level browser navigation, not an XHR call.
  login() {
    window.location.href = `${environment.apiBaseUrl}/auth/login`;
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
                  id: res.sub!,
                  email: res.email,
                  name: res.name,
                  role: res.role || 'bodorgo',
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
