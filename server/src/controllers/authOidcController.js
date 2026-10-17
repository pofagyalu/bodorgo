import * as openidClient from 'openid-client';
import crypto from 'crypto';
import config from '../config.js';
import User from '../models/userModel.js';
import logger from '../logger.js';
import AppError from '../utils/appError.js';
import { emailMatch, isInitialAdmin } from '../utils/roleManager.js';
import { AUTHENTIK, getOidcClient } from '../utils/oidcSettings.js';
import { linkIdentity } from '../utils/userIdentities.js';
import {
  endAppSessions,
  listAppSessions,
  replaceSameDeviceSessions,
} from '../utils/appSessions.js';
import {
  clearOlderAuthentikSessions,
  endAuthentikSessions,
  listAuthentikSessions,
} from '../utils/authentikSessions.js';
import { deviceName } from '../utils/deviceName.js';

// How long a login started but not finished keeps its session.
const LOGIN_ATTEMPT_MINUTES = 15;
import { STEP_UP_MAX_AGE_SECONDS, freshLoginSecondsLeft } from '../auth/freshLogin.js';
import { disconnectSessions } from '../chat/tourEvents.js';

// Authentik is only the identity provider: it says who someone is, not
// their role - roles live in the app (see utils/roleManager.js). Only
// people an admin already added (Klub → Felhasználók, with their e-mail)
// can log in; anyone else Authentik lets through is refused. The one
// exception is INITIAL_ADMIN_USER, so a brand-new installation can be
// entered at all: their first login creates them as the role-managing
// admin.

// In local dev, send the browser back to the Angular dev server (ng serve)
// rather than the configured production client URL. Always ends in '/', so
// callers can append a path directly (e.g. `${base}login`).
function getClientBaseUrl(req) {
  const isLocalRequest = ['localhost', '127.0.0.1'].includes(req.hostname);
  return isLocalRequest ? 'http://localhost:4200/' : config.clientBaseUrl || '/';
}

// Where a re-identification (?stepup=1) lands afterwards: a page of the
// client, given as its path - never an address of somewhere else.
export function safeReturnTo(value) {
  const path = String(value ?? '');
  return /^\/(?![/\\])[^\s\\]{0,300}$/.test(path) ? path : null;
}

export const login = async (req, res) => {
  // The emergency login is on (LOCAL_LOGIN=true, see localLogin below):
  // nobody goes to the provider - every "log in" button lands on the
  // client's login page, which asks for the e-mail and password.
  if (config.localLogin) return res.redirect(`${getClientBaseUrl(req)}login`);

  const { oidcConfig } = await getOidcClient();

  /**
   * code_verifier, state and nonce MUST be generated fresh for every
   * redirect to the authorization_endpoint, and stored in the end-user
   * session so they can be recovered when the user is redirected back.
   */
  const code_verifier = openidClient.randomPKCECodeVerifier();
  const codeChallenge = await openidClient.calculatePKCECodeChallenge(code_verifier);
  const state = openidClient.randomState();
  const nonce = openidClient.randomNonce();

  req.session.oidc = { code_verifier, state, nonce, returnTo: safeReturnTo(req.query.returnTo) };
  // Only a login on its way: if they never come back from the provider,
  // it is gone in a quarter of an hour, not 90 days (the callback's
  // regenerate makes the real session, with the full life). Not when they
  // are logged in already (re-identifying): that session keeps its life.
  if (!req.session.user && req.session.cookie) {
    req.session.cookie.maxAge = LOGIN_ATTEMPT_MINUTES * 60000;
  }
  await req.session.save(); // ensure it is written to Mongo before the redirect

  // Computed from the actual incoming request rather than a fixed env var,
  // so this works unchanged whether the request came in on localhost (dev)
  // or api.bodorgo.hu (prod) - as long as BOTH are registered as allowed
  // Redirect URIs on the Authentik provider itself.
  const redirectUri = `${req.protocol}://${req.get('host')}/auth/callback`;

  const parameters = {
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  };
  // A sensitive operation asks who they are again (?stepup=1, see
  // auth/freshLogin.js): the provider must not let its own still-living
  // session through unless they logged in there within max_age seconds.
  // Not prompt=login: Authentik obeys that only once in a session of its
  // own (seen 2026-10-09; its authorize view remembers the login it asked
  // again for), while max_age it compares with the login's age every time.
  if (req.query.stepup === '1') parameters.max_age = STEP_UP_MAX_AGE_SECONDS;

  const redirectTo = openidClient.buildAuthorizationUrl(oidcConfig, parameters);

  logger.info(`🔵 Authorization URL: ${redirectTo.href}`);
  return res.redirect(redirectTo.href);
};

export const callback = async (req, res, next) => {
  logger.info('🔵 CALLBACK HIT');

  try {
    const { oidcConfig, provider } = await getOidcClient();

    const currentUrl = new URL(`${req.protocol}://${req.get('host')}${req.originalUrl}`);

    const { code_verifier, state, nonce, returnTo } = req.session.oidc || {};

    const tokens = await openidClient.authorizationCodeGrant(oidcConfig, currentUrl, {
      pkceCodeVerifier: code_verifier,
      expectedState: state,
      expectedNonce: nonce,
      idTokenExpected: true,
    });

    const claims = tokens.claims();
    logger.info(`ID Token Claims for sub=${claims.sub}`);
    // When they really identified themselves at the provider - days ago, if
    // its own session let this login through (auth/freshLogin.js). A provider
    // that doesn't say counts as never.
    const authAt = Number.isFinite(claims.auth_time) ? claims.auth_time * 1000 : null;
    if (authAt === null) {
      logger.warn(`"${provider.name}" sent no auth_time: sensitive operations stay closed`);
    }

    // People are known by their e-mail (below), so at a provider set to
    // accept confirmed addresses only, one it doesn't vouch for is nobody's.
    if (provider.requireVerifiedEmail && claims.email_verified !== true) {
      logger.error(
        `Denying login for sub=${claims.sub} (${claims.email}): "${provider.name}" doesn't say the e-mail is verified`,
      );
      return res.redirect(`${getClientBaseUrl(req)}?error=unverified-email`);
    }

    // Who is it: the e-mail says, and nothing else - the account an admin
    // added with this address (any case). The Authentik id (sub) is only
    // noted on it: an Authentik user deleted and made again comes with a
    // new id and is the same person here; an id that comes with another
    // address is whoever that address belongs to.
    let user = claims.email ? await User.findOne(emailMatch(claims.email)) : null;
    if (user && user.sub !== claims.sub) {
      logger.info(
        user.sub
          ? `New Authentik id for ${claims.email} (sub=${claims.sub}) - the account stays theirs`
          : `Claiming the account added for ${claims.email} (sub=${claims.sub})`,
      );
      // The id is one account's alone (the model says so): off any other
      // record that still carries it.
      await User.updateMany({ sub: claims.sub, _id: { $ne: user._id } }, { $unset: { sub: 1 } });
    }

    const owner = isInitialAdmin(claims.email);
    if (!user && owner) {
      // A fresh installation: the INITIAL_ADMIN_USER creates themselves.
      user = new User({ sub: claims.sub, role: 'admin', canManageRoles: true });
      logger.info(`Created the role manager's account (${claims.email})`);
    }
    if (!user) {
      logger.error(`Denying login for sub=${claims.sub} (${claims.email}): not added in the app`);
      return res.redirect(`${getClientBaseUrl(req)}?error=not-invited`);
    }
    // Felfüggesztve (Klub → Felhasználók): locked out until an admin
    // restores them.
    if (user.retired) {
      logger.warn(`Denying login for ${claims.email}: suspended`);
      return res.redirect(`${getClientBaseUrl(req)}?error=suspended`);
    }

    // Name and e-mail follow Authentik (the identity provider); the role is
    // the app's own and never changes here.
    user.sub = claims.sub;
    // The same id, under its provider (the token's issuer) - what stays
    // true of them when the provider is changed (userModel.js's identities).
    await linkIdentity(user, claims.iss || provider.issuer, claims.sub);
    user.email = claims.email;
    user.name = claims.name || claims.preferred_username || claims.email;
    user.emailVerified = !!claims.email_verified;
    user.previousLoginAt = user.lastLoginAt;
    user.lastLoginAt = new Date();
    // The role-manager flag is the INITIAL_ADMIN_USER's alone, checked at
    // every login (not only at start): an account that somehow got it
    // loses it the moment anyone else logs in to it.
    user.canManageRoles = owner;
    if (owner) user.role = 'admin';
    await user.save();

    req.session.regenerate((err) => {
      if (err) return next(err);

      req.session.user = {
        id: user._id.toString(),
        sub: claims.sub,
        email: user.email,
        name: user.name,
        role: user.role,
        id_token: tokens.id_token,
        // Which provider the token is from - the one to log out of.
        provider: provider.id,
        authAt,
        ...loginDevice(req),
      };

      req.session.save(async () => {
        await replaceSameDeviceSessions(user._id, req.session.user, req.sessionID).catch((e) =>
          logger.warn(`Old sessions of the same device not cleared: ${e.message}`),
        );
        // Authentik's dead records of this browser too - not waited for.
        if (provider.id === AUTHENTIK) {
          clearOlderAuthentikSessions(user.email, req.session.user.userAgent).catch((e) =>
            logger.warn(`Older Authentik sessions of ${user.email} not cleared: ${e.message}`),
          );
        }
        logger.info('User session stored. Redirecting…');
        return res.redirect(`${getClientBaseUrl(req)}${(returnTo ?? '/').slice(1)}`);
      });
    });
  } catch (err) {
    logger.error(`❌ CALLBACK ERROR: ${err}`);
    if (err.response) {
      logger.error(`🔴 RAW TOKEN ERROR STATUS: ${err.response.status}`);
      logger.error(`🔴 RAW TOKEN ERROR BODY: ${err.response.body?.toString()}`);
    }
    return res.status(500).send('Login failed');
  }
};

// What a session keeps of the browser it was made in, for Profilom →
// Bejelentkezések (utils/appSessions.js): the device, the address, when.
const loginDevice = (req) => ({
  userAgent: String(req.get('user-agent') ?? '').slice(0, 300),
  // Brave and Chrome send the same User-Agent - only this tells them apart.
  brands: String(req.get('sec-ch-ua') ?? '').slice(0, 300),
  ip: req.ip,
  loginAt: Date.now(),
});

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
  // Suspended meanwhile: as good as logged out (requireAuth.js refuses
  // them too).
  if (!user || user.retired) {
    return res.json({ loggedIn: false });
  }

  return res.json({
    loggedIn: true,
    id: user._id.toString(),
    sub: user.sub,
    email: user.email,
    name: user.name,
    role: user.role,
    // The one admin who may change roles (utils/roleManager.js).
    canManageRoles: !!user.canManageRoles,
    familyId: user.familyId,
    wantsEmailNotifications: user.wantsEmailNotifications,
    address: user.address,
    // The header's own avatar (see header.html).
    photoUpdatedAt: user.photoUpdatedAt ?? null,
    // For how long sensitive operations are still open without identifying
    // again (auth/freshLogin.js); 0: they ask first.
    freshLoginSecondsLeft: freshLoginSecondsLeft(req),
  });
};

export const logout = async (req, res) => {
  try {
    // This browser's open chat connections end with its session.
    if (req.sessionID) await disconnectSessions([req.sessionID]);
    const idToken = req.session?.user?.id_token;
    // Logged in with a password (localLogin below): there is no provider to
    // log out of.
    if (!idToken) {
      return req.session.destroy(() => res.redirect(getClientBaseUrl(req)));
    }

    const { provider, oidcConfig } = await getOidcClient();
    // Where the provider ends its own session: it says so itself; Authentik's
    // is known anyway.
    const endSession =
      oidcConfig.serverMetadata?.().end_session_endpoint ??
      (provider.id === AUTHENTIK ? `${provider.issuer}end-session/` : null);
    // The token is another provider's (the active one was changed since
    // this login), or this one has no logout of its own: only the app's
    // session ends.
    if ((req.session.user.provider ?? AUTHENTIK) !== provider.id || !endSession) {
      return req.session.destroy(() => res.redirect(getClientBaseUrl(req)));
    }
    const logoutUrl = new URL(endSession);
    logoutUrl.searchParams.set('id_token_hint', idToken);
    if (provider.postLogoutRedirectUri) {
      logoutUrl.searchParams.set('post_logout_redirect_uri', provider.postLogoutRedirectUri);
    }

    req.session.destroy(() => res.redirect(logoutUrl.href));
  } catch (err) {
    logger.error(`LOGOUT ERROR: ${err}`);
    return res.status(500).send('Logout failed');
  }
};

// --- Local login: the emergency way in, without a provider ---
//
// LOCAL_LOGIN=true in the server's .env: the login page asks for an e-mail
// and a password instead of sending people to the OIDC provider - so the
// app can be entered where there is no Authentik (yet): a reinstall
// somewhere else, a broken provider. One person only, the role manager:
// the e-mail is INITIAL_ADMIN_USER, the password INITIAL_ADMIN_PASSWORD -
// both read from .env at every try. The app keeps and changes no password:
// they set the new provider up (Beállítások → OIDC szolgáltató), LOCAL_LOGIN
// goes back to false, and everybody logs in through the provider again.

// GET /auth/mode - public: which of the two the login page shows.
export const mode = (req, res) => res.json({ localLogin: config.localLogin });

const MIN_ADMIN_PASSWORD = 12;

// Compared as digests: the same length whatever was typed, in the same time.
const sameText = (a, b) => {
  const digest = (text) => crypto.createHash('sha256').update(String(text)).digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
};

// POST /auth/local-login - { email, password }.
export const localLogin = async (req, res, next) => {
  if (!config.localLogin) throw new AppError('A jelszavas belépés nincs bekapcsolva.', 404);

  const email = String(req.body?.email ?? '').trim();
  const expected = config.initialAdminPassword ?? '';
  const matches = sameText(req.body?.password ?? '', expected);
  if (expected.length < MIN_ADMIN_PASSWORD) {
    logger.error(
      `LOCAL_LOGIN=true, but INITIAL_ADMIN_PASSWORD is missing or shorter than ${MIN_ADMIN_PASSWORD} characters - nobody can log in.`,
    );
  }
  if (expected.length < MIN_ADMIN_PASSWORD || !isInitialAdmin(email) || !matches) {
    logger.warn(`Local login refused for ${email || '(no e-mail)'}`);
    throw new AppError('Hibás e-mail cím vagy jelszó.', 401);
  }

  // Their account - made now on an installation that has none yet -, with
  // every right, as at a provider login.
  const user =
    (await User.findOne(emailMatch(email))) ??
    new User({ email: config.initialAdminUser, name: config.initialAdminUser });
  if (user.isNew) logger.info(`Created the role manager's account (${user.email})`);
  user.role = 'admin';
  user.canManageRoles = true;
  user.previousLoginAt = user.lastLoginAt;
  user.lastLoginAt = new Date();
  await user.save({ validateModifiedOnly: true });

  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.user = {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      // The password was typed just now (auth/freshLogin.js) - and is typed
      // again here, when a sensitive operation asks for it later.
      authAt: Date.now(),
      ...loginDevice(req),
    };
    req.session.save(async () => {
      await replaceSameDeviceSessions(user._id, req.session.user, req.sessionID).catch((e) =>
        logger.warn(`Old sessions of the same device not cleared: ${e.message}`),
      );
      res.status(200).json({ status: 'success' });
    });
  });
};

// Profilom → Bejelentkezések: where I am logged in. `app`: my sessions in
// Bódorgó itself (this one marked `current`); `authentik`: the devices
// Authentik remembers me on, which may log in again without a password
// (null: no Authentik API token; `authentikError` when it could not be
// asked). `here`: this browser as both lists name it, to compare with.
export const sessions = async (req, res) => {
  const app = await listAppSessions(req.user._id, req.sessionID);
  let authentik = null;
  let authentikError = null;
  try {
    authentik = await listAuthentikSessions(req.user.email);
  } catch (err) {
    logger.warn(`Authentik sessions of ${req.user.email} could not be listed: ${err.message}`);
    authentikError = 'Az Oridzsinátor most nem válaszol.';
  }
  res.status(200).json({
    status: 'success',
    data: {
      here: { device: deviceName(req.get('user-agent'), req.get('sec-ch-ua')), ip: req.ip },
      app,
      authentik,
      authentikError,
    },
  });
};

// Profilom → Bejelentkezések → "Kijelentkezés minden más eszközön": every
// other browser of mine is logged out of the app at its next click, and
// Authentik forgets all my devices, so none of them gets back in without
// the password. This browser stays logged in to the app. The app sessions
// go first: if Authentik can't be reached, they are still logged out, and
// the answer says Authentik is left (`authentikEnded: null`).
export const logoutOtherSessions = async (req, res) => {
  const appEnded = await endAppSessions(req.user._id, { except: req.sessionID });
  let authentikEnded = null;
  try {
    authentikEnded = await endAuthentikSessions(req.user.email);
  } catch (err) {
    logger.warn(`Authentik sessions of ${req.user.email} could not be ended: ${err.message}`);
  }
  logger.info(
    `${req.user.email} logged out their other devices: ${appEnded} app sessions, ${authentikEnded ?? 'no'} Authentik sessions`,
  );
  res.status(200).json({ status: 'success', data: { appEnded, authentikEnded } });
};
