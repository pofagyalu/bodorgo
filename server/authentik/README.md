# Authentik (oridzs.terfotozas.hu) - what the app relies on

Authentik is set up by hand in its admin UI; this folder keeps the pieces
that live outside it, plus notes on the setup.

## E-mail templates

- `bodorgo-email-megerosites.html` - the "confirm your e-mail" message of
  the invitation sign-up.
- `bodorgo-jelszo-visszaallitas.html` - the "set a new password" message of
  the password recovery flow. It says the link is valid for 30 minutes -
  the recovery e-mail stage's token expiry; change both together.

The copies Authentik uses are on the NAS in
`/volume2/docker/authentik/custom-templates/`; after editing one here, copy
it there. Their logo is `client/src/assets/images/oridzsinator-logo.png`, served as
https://bodorgo.hu/assets/images/oridzsinator-logo.png (deployed with the
client).

## Flows

- **enrollment-invitation** (Felhasználók → Meghívók links): 10 invitation
  check, 20 prompt (5 fields + `password-complexity-bodorgo`, min 15 chars),
  30 user write (inactive, internal, group `bodorgo`), 35 e-mail verify (the
  template above), 40 login, 50 redirect to https://api.bodorgo.hu/auth/login.
- **Google source**: user matching "link to a user with identical e-mail";
  authentication flow `default-source-authentication`; enrollment flow
  `default-source-enrollment` = 0 prompt (username, email, name - no
  password), 1 `bodorgo-source-enrollment-write` (active, internal, group
  `bodorgo`), 2 login.
- **bodorgo-logout** (the Bódorgó provider's invalidation flow): logs out of
  Authentik too, with no "logged out of the application" choice screen.
  The app's logout sends `post_logout_redirect_uri` = AUTHENTIK_POSTLOGOUT_URI
  (https://bodorgo.hu).

## App access

The group `bodorgo` is bound to the Bódorgó application. The service account
`bodorgo-app` (role `bodorgo-invitations`: add/view/delete Invitation) owns
the token in AUTHENTIK_API_TOKEN (server `.env`). Roles are managed in the
app itself, not in Authentik.
