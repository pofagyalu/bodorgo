import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

// Klub (and everything under it) is for paying club members and admins
// only - a logged-in guest (e.g. a dependent added by a family who never
// logged in themselves, or anyone Authentik hasn't granted membership to)
// should never reach it, whether via the header menu or by typing the URL.
export const memberGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const role = auth.user()?.role;
  if (role === 'admin' || role === 'member') {
    return true;
  }

  router.navigate(['/']);
  return false;
};
