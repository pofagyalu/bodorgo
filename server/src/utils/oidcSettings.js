import * as openidClient from 'openid-client';
import ClubSettings from '../models/clubSettingsModel.js';
import config from '../config.js';
import logger from '../logger.js';
import { getClubSettings } from './clubSettings.js';
import { canEncrypt, decryptSecret, encryptSecret } from './secretBox.js';

// The OIDC provider people log in through - Authentik - and the API token
// its invitations are made with. Set by the role manager on Beállítások →
// OIDC szolgáltató and kept in the club settings (clubSettingsModel.js's
// oidc), the two secrets encrypted. The AUTHENTIK_* lines of .env are only
// what the first start copies over, and what stands in when the saved
// secrets can't be read (another APP_SECRET_KEY, e.g. a database copied
// from elsewhere) - once login works from the saved ones, they can go from
// .env. The way back in after saving something wrong is the emergency
// login (LOCAL_LOGIN - authOidcController.js's localLogin).

export const DEFAULT_INVITATION_FLOW = 'enrollment-invitation';

export const trimUrl = (url) =>
  String(url ?? '')
    .trim()
    .replace(/\/+$/, '');

function envSettings() {
  const env = config.oidcEnv;
  return {
    serverUrl: trimUrl(env.serverUrl),
    providerSlug: env.providerSlug ?? '',
    clientId: env.clientId ?? '',
    clientSecret: env.clientSecret ?? '',
    postLogoutRedirectUri: env.postLogoutRedirectUri ?? '',
    apiToken: env.apiToken ?? '',
    invitationFlow: env.invitationFlow || DEFAULT_INVITATION_FLOW,
    source: 'env',
  };
}

// Unreadable saved secrets are said once per start (a warning: login goes
// on with .env, and the OIDC szolgáltató tab shows it) - not at every
// lookup, which is every login. Said again if they were readable meanwhile.
let toldUnreadable = false;

// The settings in use now, secrets readable - for the server's own use,
// never sent to a browser. source: 'database' or 'env'; unreadable: the
// saved secrets couldn't be decrypted, so .env stands in.
export async function getOidcSettings() {
  const env = envSettings();
  const doc = await ClubSettings.findOne({ key: 'club' })
    .select('+oidc.clientSecretEnc +oidc.apiTokenEnc')
    .lean();
  const saved = doc?.oidc;
  if (!saved?.serverUrl || !saved.clientId || !saved.clientSecretEnc) return env;

  try {
    const settings = {
      serverUrl: trimUrl(saved.serverUrl),
      providerSlug: saved.providerSlug ?? '',
      clientId: saved.clientId,
      clientSecret: decryptSecret(saved.clientSecretEnc),
      postLogoutRedirectUri: saved.postLogoutRedirectUri ?? '',
      apiToken: saved.apiTokenEnc ? decryptSecret(saved.apiTokenEnc) : '',
      invitationFlow: saved.invitationFlow || DEFAULT_INVITATION_FLOW,
      source: 'database',
    };
    toldUnreadable = false;
    return settings;
  } catch (err) {
    if (!toldUnreadable) {
      toldUnreadable = true;
      logger.warn(
        `OIDC settings: the saved secrets can't be read with this APP_SECRET_KEY (${err.message}) - using .env`,
      );
    }
    return { ...env, unreadable: true };
  }
}

// Authentik's provider address - what the ID tokens name as their issuer.
export const issuerUrl = ({ serverUrl, providerSlug }) =>
  `${trimUrl(serverUrl)}/application/o/${providerSlug}/`;

// --- Providers: Authentik, and any others added next to it ---
//
// What a login needs of a provider, whichever kind it is: { id, name,
// issuer, clientId, clientSecret, postLogoutRedirectUri,
// requireVerifiedEmail }. Authentik's id is 'authentik'; its e-mail
// addresses are taken as they come (it is the club's own).

export const AUTHENTIK = 'authentik';

export const authentikProvider = (settings) => ({
  id: AUTHENTIK,
  name: 'Authentik',
  issuer: issuerUrl(settings),
  clientId: settings.clientId,
  clientSecret: settings.clientSecret,
  postLogoutRedirectUri: settings.postLogoutRedirectUri,
  requireVerifiedEmail: false,
});

// The other providers as saved, and which one is active - secrets readable
// (unreadable: true where one can't be decrypted with this server's key).
export async function getOtherProviders() {
  const doc = await ClubSettings.findOne({ key: 'club' })
    .select('+oidcProviders.clientSecretEnc')
    .lean();
  const providers = (doc?.oidcProviders ?? []).map((saved) => {
    const provider = {
      id: saved.id,
      name: saved.name,
      issuer: saved.issuerUrl,
      clientId: saved.clientId,
      clientSecret: '',
      postLogoutRedirectUri: saved.postLogoutRedirectUri ?? '',
      requireVerifiedEmail: saved.requireVerifiedEmail !== false,
    };
    try {
      provider.clientSecret = saved.clientSecretEnc ? decryptSecret(saved.clientSecretEnc) : '';
    } catch {
      provider.unreadable = true;
    }
    return provider;
  });
  const active = providers.some((p) => p.id === doc?.oidcActiveProvider)
    ? doc.oidcActiveProvider
    : AUTHENTIK;
  return { providers, active };
}

// The one everybody logs in through. Authentik unless another was made
// active - and also when that one's secret can't be read here.
export async function getActiveProvider() {
  const authentik = authentikProvider(await getOidcSettings());
  const { providers, active } = await getOtherProviders();
  const chosen = providers.find((p) => p.id === active);
  if (!chosen) return authentik;
  if (!chosen.clientSecret) {
    logger.error(`OIDC: the secret of "${chosen.name}" can't be read here - using Authentik`);
    return authentik;
  }
  return chosen;
}

// The provider's own description of itself (discovery) - throws when it
// can't be reached at its issuer address.
export const discover = (provider) =>
  openidClient.discovery(new URL(provider.issuer), provider.clientId, provider.clientSecret);

// A provider's client. Each discovery is kept until that provider's
// settings change.
const clients = new Map();

function clientOf(provider) {
  const key = [provider.issuer, provider.clientId, provider.clientSecret].join('\n');
  const cached = clients.get(provider.id);
  if (cached?.key === key) return cached.promise;
  const promise = Promise.resolve()
    .then(() => discover(provider))
    .catch((err) => {
      if (clients.get(provider.id)?.promise === promise) clients.delete(provider.id);
      throw err;
    });
  clients.set(provider.id, { key, promise });
  return promise;
}

// The active provider and its client - what a login goes through.
export async function getOidcClient() {
  const provider = await getActiveProvider();
  return { provider, oidcConfig: await clientOf(provider) };
}

// Authentik's own, whichever provider is active.
export async function getAuthentikClient() {
  return clientOf(authentikProvider(await getOidcSettings()));
}

// What the settings document stores of them.
export const storedOidc = (values) => ({
  serverUrl: trimUrl(values.serverUrl),
  providerSlug: values.providerSlug,
  clientId: values.clientId,
  clientSecretEnc: encryptSecret(values.clientSecret),
  postLogoutRedirectUri: values.postLogoutRedirectUri || undefined,
  apiTokenEnc: values.apiToken ? encryptSecret(values.apiToken) : undefined,
  invitationFlow: values.invitationFlow || DEFAULT_INVITATION_FLOW,
});

// At server start: while nothing is saved in the app yet, what .env has is
// copied over - so moving the settings into the app needs nothing done by
// hand.
export async function importOidcSettingsFromEnv() {
  const env = envSettings();
  if (!env.serverUrl || !env.clientId || !env.clientSecret) return;
  const settings = await getClubSettings();
  if (settings.oidc?.serverUrl) return;
  if (!canEncrypt()) {
    logger.warn('APP_SECRET_KEY is not set - the OIDC settings stay in .env.');
    return;
  }
  settings.set('oidc', storedOidc(env));
  settings.history.push({
    at: new Date(),
    byName: 'Szerver',
    change: 'OIDC szolgáltató: átvéve a szerver .env fájljából',
  });
  await settings.save();
  logger.info('OIDC settings copied from .env into the database.');
}
