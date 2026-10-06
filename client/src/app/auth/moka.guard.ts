import { inject } from '@angular/core';
import { Router, RouterStateSnapshot } from '@angular/router';
import { map, catchError, of } from 'rxjs';
import { AuthService, CurrentUser } from './auth.service';
import { canSeeFutokor } from './futokor.guard';

// Who sees Móka (the games) - the menu item and its pages alike: everyone
// logged in, since 2026-10-04 (while the games were being built, only the
// role manager did). The server's twin: jatekok/access.js. Futókörök, the
// running race, has its own line (futokor.guard.ts) - everyone's too,
// since 2026-10-06.
export const canSeeMoka = (user: CurrentUser | null) => !!user;

// Asks the server first (like authGuard), so it also works on a fresh page
// load straight to a Móka URL.
// Futókörök (the running race) also opens on a phone that already has a
// course on it, whatever the server says or doesn't: in the garden there
// may be no connection to ask, and the run must go on (what the phone
// sends is checked by the server anyway).
// Also the guard of every page inside Móka (canActivateChild).
export const mokaGuard = (_route: unknown, state: RouterStateSnapshot) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const raceOnThisPhone =
    state.url.startsWith('/moka/futokor') && !!localStorage.getItem('futokor-course');
  const race = state.url.startsWith('/moka/futokor');

  return auth.checkAuth().pipe(
    map(() => {
      const allowed = race ? canSeeFutokor(auth.user()) : canSeeMoka(auth.user());
      if (allowed || raceOnThisPhone) return true;
      router.navigate(['/']);
      return false;
    }),
    catchError(() => {
      router.navigate(['/']);
      return of(false);
    }),
  );
};
