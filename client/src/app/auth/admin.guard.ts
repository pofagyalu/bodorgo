import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { map, catchError, of } from 'rxjs';
import { AuthService } from './auth.service';

// Stricter than memberGuard - admin only (e.g. the Klub Felhasználók
// "Szerkesztés" page, which exposes gender/familyId/email for whichever
// user id is in the URL). Same checkAuth()-first reasoning as
// memberGuard: a fresh top-level navigation can reach this before
// AppComponent's own auth check has resolved, so this can't just read
// auth.user() synchronously.
export const adminGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.checkAuth().pipe(
    map(() => {
      if (auth.user()?.role === 'admin') {
        return true;
      }
      router.navigate(['/klub/felhasznalok']);
      return false;
    }),
    catchError(() => {
      router.navigate(['/klub/felhasznalok']);
      return of(false);
    }),
  );
};
