// Why the server's login callback (authOidcController.js) didn't let someone
// in - it sends them to the landing page with ?error=<code>, and the
// landing page (pages/home) says it.
export const LOGIN_REFUSALS: Record<string, string> = {
  // Authentik let them in, but no admin has added them in the app
  // (Klub → Felhasználók) - no session was created.
  'not-invited':
    'Még nem vagy felvéve a klub alkalmazásába - kérd meg egy admint, hogy vegyen fel.',
  // The provider doesn't say their e-mail address is confirmed, and it is
  // set to let in only those it does (Beállítások → OIDC szolgáltató).
  'unverified-email':
    'Az e-mail címed még nincs megerősítve - erősítsd meg a belépéshez használt fiókodban, aztán próbáld újra.',
  // Felfüggesztve (Klub → Felhasználók): locked out until an admin
  // restores them.
  suspended: 'A fiókod fel van függesztve - ha szerinted ez tévedés, keress meg egy admint.',
};
