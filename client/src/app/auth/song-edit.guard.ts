import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { map, catchError, of } from 'rxjs';
import { AuthService, CurrentUser } from './auth.service';

// Who may add and change the Daloskönyv's songs: only the one role manager
// (the server's twin: songController.js's canEditSongs) - not the other
// admins.
export const canEditSongs = (user: CurrentUser | null) => !!user?.canManageRoles;

// Asks the server first (like authGuard), so it also works on a fresh page
// load straight to the editor's address. Anyone else goes back to the
// front page.
export const songEditGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.checkAuth().pipe(
    map(() => {
      if (canEditSongs(auth.user())) return true;
      router.navigate(['/']);
      return false;
    }),
    catchError(() => {
      router.navigate(['/']);
      return of(false);
    }),
  );
};
