import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';
import { AuthService } from './auth.service';

export const authHttpInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  return next(req.clone({ withCredentials: true })).pipe(
    tap({
      // A sensitive operation the server refused because the last real
      // login is too old (server auth/freshLogin.js): the next try asks to
      // identify again first (fresh-login.service.ts).
      error: (err: HttpErrorResponse) => {
        if (err.status === 403 && err.error?.code === 'fresh-login-required') {
          auth.freshLoginGone();
        }
      },
    }),
  );
};
