import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { map, catchError, of } from 'rxjs';
import { AuthService, CurrentUser } from './auth.service';

// Who sees Móka (the games) - the menu item and its pages alike. While the
// games are being built: only the one initial admin (the role manager, see
// the server's utils/roleManager.js) - not the other admins. Once they're
// ready, this is the line that opens them to everyone logged in.
export const canSeeMoka = (user: CurrentUser | null) => !!user?.canManageRoles;

// Asks the server first (like authGuard), so it also works on a fresh page
// load straight to a Móka URL.
export const mokaGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.checkAuth().pipe(
    map(() => {
      if (canSeeMoka(auth.user())) return true;
      router.navigate(['/']);
      return false;
    }),
    catchError(() => {
      router.navigate(['/']);
      return of(false);
    }),
  );
};
