import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment.development';
import { BehaviorSubject, tap } from 'rxjs';

interface UsernameAvailableResponse {
  available: boolean;
}

export interface SignupCredentials {
  email: string;
  password: string;
  // passwordConfirm: string;
}

interface Signupresponse {}

interface SignedinResponse {
  data: {
    user: {
      authenticated: boolean;
      username: string;
      role: string;
    };
  };
}

export interface SigninCredentials {
  email: string;
  password: string;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  signedin$ = new BehaviorSubject(false);

  constructor(private http: HttpClient) {}

  emailAvailable(email: string) {
    return this.http.post<UsernameAvailableResponse>(
      'https://api.angular-email.com/auth/username',
      {
        username: email,
      }
    );
  }

  signup(credentials: SignupCredentials) {
    return this.http
      .post<Signupresponse>(`${environment.apiUrl}/users/signup`, credentials)
      .pipe(
        tap(() => {
          this.signedin$.next(true);
        })
      );
  }

  checkAuth() {
    return this.http
      .get<SignedinResponse>(`${environment.apiUrl}/users/signedin`)
      .pipe(
        tap(({ data }) => {
          this.signedin$.next(data.user.authenticated);
        })
      );
  }

  logout() {
    return this.http.post(`${environment.apiUrl}/users/logout`, {}).pipe(
      tap(() => {
        this.signedin$.next(false);
      })
    );
  }

  login(credentials: SigninCredentials) {
    return this.http
      .post(`${environment.apiUrl}/users/login`, credentials)
      .pipe(
        tap(() => {
          this.signedin$.next(true);
        })
      );
  }
}
