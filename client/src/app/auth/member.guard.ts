import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { map, catchError, of } from 'rxjs';
import { AuthService } from './auth.service';

// Klub (and everything under it) is for paying club members and admins
// only - a logged-in guest (e.g. a dependent added by a family who never
// logged in themselves, or anyone Authentik hasn't granted membership to)
// should never reach it, whether via the header menu or by typing the URL.
//
// Calls checkAuth() itself rather than trusting auth.user() to already be
// populated - on a fresh top-level navigation (e.g. Stripe redirecting the
// browser straight back to a Klub page after a membership payment), this
// guard runs before AppComponent's own ngOnInit has resolved /auth/me, so
// reading the signal directly would see it still empty and wrongly bounce
// a real member/admin back to the homepage.
// Média's Videók and Fotók are the members'; a guest has Zene there - so
// that is where a guest is taken instead (also from Média's own address,
// which opens Videók).
export const mediaMemberGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.checkAuth().pipe(
    map(() => {
      const role = auth.user()?.role;
      if (role === 'admin' || role === 'member') return true;
      return router.parseUrl(auth.isLoggedIn() ? '/media/zene' : '/');
    }),
    catchError(() => of(router.parseUrl('/'))),
  );
};

export const memberGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.checkAuth().pipe(
    map(() => {
      const role = auth.user()?.role;
      if (role === 'admin' || role === 'member') {
        return true;
      }
      router.navigate(['/']);
      return false;
    }),
    catchError(() => {
      router.navigate(['/']);
      return of(false);
    }),
  );
};

// Média → Könyvtár is the role manager's alone (the server's twin:
// libraryController.js's libraryOwnerOnly) - anyone else is taken to Média.
export const canSeeLibrary = (user: { canManageRoles?: boolean } | null) => !!user?.canManageRoles;

export const libraryGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.checkAuth().pipe(
    map(() => canSeeLibrary(auth.user()) || router.parseUrl(auth.isLoggedIn() ? '/media' : '/')),
    catchError(() => of(router.parseUrl('/'))),
  );
};
