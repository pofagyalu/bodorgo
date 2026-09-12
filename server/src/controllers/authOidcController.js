import * as openidClient from 'openid-client';
import config from '../config.js';
import User from '../models/userModel.js';
import logger from '../logger.js';

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
    scope: 'openid email profile',
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

    let user = await User.findOne({ sub: claims.sub });
    if (!user) {
      user = await User.create({
        sub: claims.sub,
        email: claims.email,
        name: claims.name || claims.preferred_username || claims.email,
        emailVerified: !!claims.email_verified,
      });
      logger.info(`Provisioned new local user for sub=${claims.sub}`);
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
        // In local dev, send the browser back to the Angular dev server
        // (ng serve) rather than the configured production client URL.
        const isLocalRequest = ['localhost', '127.0.0.1'].includes(
          req.hostname,
        );
        const clientRedirect = isLocalRequest
          ? 'http://localhost:4200/'
          : config.oridzs.clientBaseUrl || '/';
        return res.redirect(clientRedirect);
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

  return res.json({
    loggedIn: true,
    sub: req.session.user.sub,
    email: req.session.user.email,
    name: req.session.user.name,
    role: req.session.user.role,
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
