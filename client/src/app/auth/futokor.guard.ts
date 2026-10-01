import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { map, catchError, of } from 'rxjs';
import { AuthService, CurrentUser } from './auth.service';

// Who sees Futókör (the running race, the Versenyek menu). While it's being
// built: only the one initial admin (the role manager) - not the other
// admins; the same as Móka (moka.guard.ts). Once it's ready, this is the
// line that opens it to everyone logged in (the server's twin:
// futokor/access.js).
export const canSeeFutokor = (user: CurrentUser | null) => !!user?.canManageRoles;

// Asks the server first, so it also works on a fresh page load. (A card's
// own link - versenyek/t/... - has no guard at all: it must open in the
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

// The runner's own page also opens on a phone that already has a course on
// it, whatever the server says or doesn't: in the garden there may be no
// connection to ask, and the run must go on (what it sends is checked by
// the server anyway).
export const futokorGuard = guard(
  (user) => canSeeFutokor(user) || !!localStorage.getItem('futokor-course'),
);
// The cards and the courses are the admins'.
export const futokorAdminGuard = guard((user) => canSeeFutokor(user) && user?.role === 'admin');
