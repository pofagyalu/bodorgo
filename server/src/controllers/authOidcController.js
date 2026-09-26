import * as openidClient from 'openid-client';
import config from '../config.js';
import User from '../models/userModel.js';
import logger from '../logger.js';

// Role now comes straight from Authentik as a single claim, `bodorgo_role`,
// via a custom scope/property mapping configured on the provider itself
// (see authentik-integration-instructions.md) - an expression there reads
// the user's group membership (bodorgo-admin/bodorgo-member/bodorgo-guest)
// and returns "admin" | "member" | "guest" | null directly. This app no
// longer maps group names to a role itself (that used to happen here via a
// plain `groups` claim - a superseded design). Tested in
// tests/api/auth.test.js.
//
// A missing or unrecognized value is treated as "not enrolled" and denies
// login entirely (see callback()) rather than falling back to guest or
// keeping whatever role was there before - a deliberate choice so a broken
// invite or a removed group membership locks someone out instead of
// silently downgrading them.
const VALID_ROLES = ['admin', 'member', 'guest'];

export function roleFromClaim(bodorgoRole) {
  return VALID_ROLES.includes(bodorgoRole) ? bodorgoRole : null;
}

// In local dev, send the browser back to the Angular dev server (ng serve)
// rather than the configured production client URL. Always ends in '/', so
// callers can append a path directly (e.g. `${base}login`).
function getClientBaseUrl(req) {
  const isLocalRequest = ['localhost', '127.0.0.1'].includes(req.hostname);
  return isLocalRequest
    ? 'http://localhost:4200/'
    : config.oridzs.clientBaseUrl || '/';
}

let oidcConfigPromise;

function getOidcConfig() {
  if (!oidcConfigPromise) {
    const { server, clientId, clientSecret, providerSlug } = config.oridzs;

    oidcConfigPromise = openidClient
      .discovery(
        new URL(`${server}/application/o/${providerSlug}/`),
        clientId,
        clientSecret,
      )
      .catch((err) => {
        oidcConfigPromise = undefined;
        throw err;
      });
  }

  return oidcConfigPromise;
}

export const login = async (req, res) => {
  const oidcConfig = await getOidcConfig();

  /**
   * code_verifier, state and nonce MUST be generated fresh for every
   * redirect to the authorization_endpoint, and stored in the end-user
   * session so they can be recovered when the user is redirected back.
   */
  const code_verifier = openidClient.randomPKCECodeVerifier();
  const codeChallenge =
    await openidClient.calculatePKCECodeChallenge(code_verifier);
  const state = openidClient.randomState();
  const nonce = openidClient.randomNonce();

  req.session.oidc = { code_verifier, state, nonce };
  await req.session.save(); // ensure it is written to Mongo before the redirect

  // Computed from the actual incoming request rather than a fixed env var,
  // so this works unchanged whether the request came in on localhost (dev)
  // or api.bodorgo.hu (prod) - as long as BOTH are registered as allowed
  // Redirect URIs on the Authentik provider itself.
  const redirectUri = `${req.protocol}://${req.get('host')}/auth/callback`;

  const parameters = {
    redirect_uri: redirectUri,
    // 'bodorgo_role' drives role entirely (see roleFromClaim above) -
    // requires the matching custom scope/property mapping configured on the
    // Authentik provider itself, not just requested here.
    scope: 'openid email profile bodorgo_role',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  };

  const redirectTo = openidClient.buildAuthorizationUrl(oidcConfig, parameters);

  logger.info(`🔵 Authorization URL: ${redirectTo.href}`);
  return res.redirect(redirectTo.href);
};

export const callback = async (req, res, next) => {
  logger.info('🔵 CALLBACK HIT');

  try {
    const oidcConfig = await getOidcConfig();

    const currentUrl = new URL(
      `${req.protocol}://${req.get('host')}${req.originalUrl}`,
    );

    const { code_verifier, state, nonce } = req.session.oidc || {};

    const tokens = await openidClient.authorizationCodeGrant(
      oidcConfig,
      currentUrl,
      {
        pkceCodeVerifier: code_verifier,
        expectedState: state,
        expectedNonce: nonce,
        idTokenExpected: true,
      },
    );

    const claims = tokens.claims();
    logger.info(`ID Token Claims for sub=${claims.sub}`);

    // Authentik's custom scope mappings aren't always embedded in the ID
    // token itself (depends on how the mapping is configured on the
    // provider) - the userinfo endpoint is the reliable place to get the
    // claim if the ID token didn't include it.
    let bodorgoRole = claims.bodorgo_role;
    if (bodorgoRole === undefined) {
      try {
        const userinfo = await openidClient.fetchUserInfo(
          oidcConfig,
          tokens.access_token,
          claims.sub,
        );
        bodorgoRole = userinfo.bodorgo_role;
      } catch (err) {
        logger.error(`Failed to fetch userinfo for bodorgo_role: ${err.message}`);
      }
    }
    logger.info(`bodorgo_role for sub=${claims.sub}: ${JSON.stringify(bodorgoRole)}`);
    const role = roleFromClaim(bodorgoRole);

    // Not enrolled in any bodorgo-* group (or the claim was missing entirely
    // - a misconfigured provider) -> deny login outright, don't create or
    // update anything locally. A role downgrade removing someone from every
    // group takes effect on their *next* login, not by killing an existing
    // session immediately - simplest option, revisit if that's ever a
    // problem in practice.
    if (role === null) {
      logger.error(`Denying login for sub=${claims.sub}: no valid bodorgo_role (got ${JSON.stringify(bodorgoRole)})`);
      return res.redirect(`${getClientBaseUrl(req)}login?error=no-role`);
    }

    let user = await User.findOne({ sub: claims.sub });

    // No login yet under this sub, but a login-less dependent record (e.g.
    // a child, see userModel.js's familyId) may already have this exact
    // email pre-assigned in anticipation of them getting their own account
    // one day - claim that record instead of provisioning a disconnected
    // new one, so their whole attendance history stays attached.
    if (!user && claims.email) {
      user = await User.findOne({ email: claims.email, sub: { $exists: false } });
      if (user) {
        logger.info(`Claiming existing dependent record for sub=${claims.sub}`);
      }
    }

    if (!user) {
      user = await User.create({
        sub: claims.sub,
        email: claims.email,
        name: claims.name || claims.preferred_username || claims.email,
        emailVerified: !!claims.email_verified,
        role,
        lastLoginAt: new Date(),
      });
      logger.info(`Provisioned new local user for sub=${claims.sub}`);
    } else {
      // Keep the local record in sync with Authentik on every login - it's
      // the source of truth for profile fields, so a name/email change made
      // there (e.g. admin -> Gazda) should show up here without needing any
      // manual DB edit. role is always a valid value at this point (see the
      // deny-login check above), so it's always synced too.
      user.sub = claims.sub; // no-op for a returning user, sets it once when claiming a dependent record
      user.email = claims.email;
      user.name = claims.name || claims.preferred_username || claims.email;
      user.emailVerified = !!claims.email_verified;
      user.lastLoginAt = new Date();
      user.role = role;
      await user.save();
    }

    req.session.regenerate((err) => {
      if (err) return next(err);

      req.session.user = {
        id: user._id.toString(),
        sub: claims.sub,
        email: user.email,
        name: user.name,
        role: user.role,
        id_token: tokens.id_token,
      };

      req.session.save(() => {
        logger.info('User session stored. Redirecting…');
        return res.redirect(getClientBaseUrl(req));
      });
    });
  } catch (err) {
    logger.error(`❌ CALLBACK ERROR: ${err}`);
    if (err.response) {
      logger.error(`🔴 RAW TOKEN ERROR STATUS: ${err.response.status}`);
      logger.error(
        `🔴 RAW TOKEN ERROR BODY: ${err.response.body?.toString()}`,
      );
    }
    return res.status(500).send('Login failed');
  }
};

export const me = async (req, res) => {
  if (!req.session.user) {
    return res.json({ loggedIn: false });
  }

  // Reads role/familyId fresh from the DB rather than the session's own
  // snapshot (taken once at login) - both can change afterwards (an admin
  // grants membership or assigns a family at any time, same as
  // requireAuth.js already does for req.user), and this way a user sees the
  // change immediately rather than needing to log out and back in.
  const user = await User.findById(req.session.user.id);
  if (!user) {
    return res.json({ loggedIn: false });
  }

  return res.json({
    loggedIn: true,
    id: user._id.toString(),
    sub: user.sub,
    email: user.email,
    name: user.name,
    role: user.role,
    familyId: user.familyId,
    wantsEmailNotifications: user.wantsEmailNotifications,
    address: user.address,
    // The header's own avatar (see header.html).
    photoUpdatedAt: user.photoUpdatedAt ?? null,
  });
};

export const logout = async (req, res) => {
  try {
    const { server, providerSlug, postLogoutRedirectUri } = config.oridzs;

    const idToken = req.session?.user?.id_token;

    const logoutUrl = new URL(
      `${server}/application/o/${providerSlug}/end-session/`,
    );

    if (idToken) {
      logoutUrl.searchParams.set('id_token_hint', idToken);
    }

    if (postLogoutRedirectUri) {
      logoutUrl.searchParams.set(
        'post_logout_redirect_uri',
        postLogoutRedirectUri,
      );
    }

    req.session.destroy(() => res.redirect(logoutUrl.href));
  } catch (err) {
    logger.error(`LOGOUT ERROR: ${err}`);
    return res.status(500).send('Logout failed');
  }
};
