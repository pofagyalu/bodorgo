import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { map, catchError, of } from 'rxjs';
import { AuthService, CurrentUser } from './auth.service';

// The Daloskönyv's keeper: the one role manager (the server's twin:
// songController.js's canEditSongs) - every song is theirs to change.
// Anyone logged in may add a song and change their own; the editor's
// guard below only asks for a login, the song says the rest (its canEdit;
// the server checks every save).
export const canEditSongs = (user: CurrentUser | null) => !!user?.canManageRoles;

// Asks the server first (like authGuard), so it also works on a fresh page
// load straight to the editor's address. Anyone else goes back to the
// front page.
export const songEditGuard = () => {
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
