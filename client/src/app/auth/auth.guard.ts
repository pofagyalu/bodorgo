import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { map, catchError, of } from 'rxjs';
import { AuthService } from './auth.service';

// Any logged-in user (guest, member or admin) - for the members-only parts
// of the app everyone who can log in may see, e.g. the tours. Asks the
// server (like memberGuard) rather than trusting an in-memory flag, so it
// also works on a fresh page load straight to a guarded URL. Logged-out
// visitors go back to the landing page, where they can log in.
export const authGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.checkAuth().pipe(
    map(() => {
      if (auth.isLoggedIn()) return true;
      router.navigate(['/']);
      return false;
    }),
    catchError(() => {
      router.navigate(['/']);
      return of(false);
    }),
  );
};
