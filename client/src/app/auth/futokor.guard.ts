import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { map, catchError, of } from 'rxjs';
import { AuthService, CurrentUser } from './auth.service';

// Who sees Futókörök (the running race, a part of Móka): everyone logged
// in - guests too - since 2026-10-06, like Móka itself (moka.guard.ts,
// which guards the runner's own page); while it was being built, only the
// role manager did. The server's twin: futokor/access.js.
export const canSeeFutokor = (user: CurrentUser | null) => !!user;

// Asks the server first, so it also works on a fresh page load. (A card's
// own link - fk/... - has no guard at all: it must open in the
// garden too, where there's no connection to ask.)
const guard = (allowed: (user: CurrentUser | null) => boolean) => () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const no = () => {
    router.navigate(['/']);
    return false;
  };
  return auth.checkAuth().pipe(
    map(() => allowed(auth.user()) || no()),
    catchError(() => of(no())),
  );
};

// The club's cards are the admins'.
export const futokorAdminGuard = guard((user) => canSeeFutokor(user) && user?.role === 'admin');
