import { inject } from '@angular/core';
import { Router, RouterStateSnapshot } from '@angular/router';
import { map, catchError, of } from 'rxjs';
import { AuthService, CurrentUser } from './auth.service';

// Who sees Móka (the games) - the menu item and its pages alike. While the
// games are being built: only the one initial admin (the role manager, see
// the server's utils/roleManager.js) - not the other admins. Once they're
// ready, this is the line that opens them to everyone logged in.
export const canSeeMoka = (user: CurrentUser | null) => !!user?.canManageRoles;

// Asks the server first (like authGuard), so it also works on a fresh page
// load straight to a Móka URL.
// Futókörök (the running race) also opens on a phone that already has a
// course on it, whatever the server says or doesn't: in the garden there
// may be no connection to ask, and the run must go on (what the phone
// sends is checked by the server anyway).
export const mokaGuard = (_route: unknown, state: RouterStateSnapshot) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const raceOnThisPhone =
    state.url.startsWith('/moka/futokor') && !!localStorage.getItem('futokor-course');

  return auth.checkAuth().pipe(
    map(() => {
      if (canSeeMoka(auth.user()) || raceOnThisPhone) return true;
      router.navigate(['/']);
      return false;
    }),
    catchError(() => {
      router.navigate(['/']);
      return of(false);
    }),
  );
};
