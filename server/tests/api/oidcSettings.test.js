import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discovery } from 'openid-client';
import { app, asUser } from '../helpers/app.js';
import { createAdmin } from '../helpers/factories.js';
import ClubSettings from '../../src/models/clubSettingsModel.js';
import config from '../../src/config.js';
import sendResendEmail from '../../src/utils/resendEmail.js';
import { getOidcSettings, importOidcSettingsFromEnv } from '../../src/utils/oidcSettings.js';
import { decryptSecret, encryptSecret } from '../../src/utils/secretBox.js';
import { invitationsEnabled } from '../../src/utils/authentikInvitations.js';

// The provider itself replaced: it answers at any address unless a test
// says otherwise.
vi.mock('openid-client', () => ({ discovery: vi.fn(async () => ({})) }));

const url = '/settings/oidc';
const owner = () => createAdmin({ name: 'Tulaj Dona', canManageRoles: true });
const valid = {
  serverUrl: 'https://login.example.org/',
  providerSlug: 'klub',
  clientId: 'new-client',
  clientSecret: 'new-secret',
  postLogoutRedirectUri: 'https://klub.example.org',
  apiToken: 'new-token',
  invitationFlow: '',
};
// What is stored, secrets included.
const stored = async () =>
  (await ClubSettings.findOne({ key: 'club' }).select('+oidc.clientSecretEnc +oidc.apiTokenEnc'))
    ?.oidc;

// tests/setup.js: AUTHENTIK_SERVER_URL=https://auth.test, client test-client
// / test-secret, slug bodorgo; APP_SECRET_KEY set.

describe('the secrets are encrypted with APP_SECRET_KEY', () => {
  it('round trip; unreadable with another key or when tampered with', () => {
    const boxed = encryptSecret('titok-123');
    expect(boxed).not.toContain('titok-123');
    expect(encryptSecret('titok-123')).not.toBe(boxed);
    expect(decryptSecret(boxed)).toBe('titok-123');
    expect(() => decryptSecret(`${boxed.slice(0, -4)}AAAA`)).toThrow();
    config.appSecretKey = 'another-key';
    expect(() => decryptSecret(boxed)).toThrow();
    config.appSecretKey = 'test-app-secret-key';
  });
});

describe('Beállítások → OIDC szolgáltató', () => {
  afterEach(() => {
    config.appSecretKey = 'test-app-secret-key';
  });

  it('only the role manager sees or saves it - not even another admin', async () => {
    const admin = await createAdmin();
    expect((await request(app).get(url).set(asUser(admin))).status).toBe(403);
    expect((await request(app).put(url).set(asUser(admin)).send(valid)).status).toBe(403);
    expect((await request(app).get(url)).status).toBe(401);
    expect((await stored())?.serverUrl).toBeUndefined();
  });

  it("shows what .env has while nothing is saved - never a secret, only that there's one", async () => {
    const res = await request(app)
      .get(url)
      .set(asUser(await owner()));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      serverUrl: 'https://auth.test',
      providerSlug: 'bodorgo',
      clientId: 'test-client',
      hasClientSecret: true,
      hasApiToken: false,
      invitationFlow: 'enrollment-invitation',
      source: 'env',
      canSave: true,
      issuer: 'https://auth.test/application/o/bodorgo/',
      localLogin: false,
    });
    expect(res.body.data.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
    expect(JSON.stringify(res.body)).not.toContain('test-secret');
  });

  it('saves them encrypted; they are what the server uses from then on', async () => {
    const me = await owner();
    const res = await request(app).put(url).set(asUser(me)).send(valid);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      serverUrl: 'https://login.example.org',
      providerSlug: 'klub',
      clientId: 'new-client',
      hasClientSecret: true,
      hasApiToken: true,
      source: 'database',
      issuer: 'https://login.example.org/application/o/klub/',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/new-secret|new-token/);
    // The provider was asked at the new address before anything was saved.
    expect(vi.mocked(discovery).mock.calls[0][0].href).toBe(
      'https://login.example.org/application/o/klub/',
    );

    const oidc = await stored();
    expect(JSON.stringify(oidc)).not.toMatch(/new-secret|new-token/);
    expect(decryptSecret(oidc.clientSecretEnc)).toBe('new-secret');
    expect(await getOidcSettings()).toMatchObject({
      clientSecret: 'new-secret',
      apiToken: 'new-token',
      source: 'database',
    });
    expect(await invitationsEnabled()).toBe(true);

    // In the history without the secrets' values, and e-mailed to the admins.
    const { history } = await ClubSettings.findOne({ key: 'club' });
    expect(history.at(-1)).toMatchObject({ byName: 'Tulaj Dona' });
    expect(history.at(-1).change).toContain(
      'Server URL: https://auth.test → https://login.example.org',
    );
    expect(history.at(-1).change).toContain('Client secret: megváltozott');
    expect(history.at(-1).change).not.toMatch(/new-secret|new-token|test-secret/);
    expect(sendResendEmail).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(sendResendEmail).mock.calls)).not.toMatch(
      /new-secret|new-token/,
    );
  });

  it('an empty secret keeps the one in use; the token can be taken away', async () => {
    const me = await owner();
    await request(app).put(url).set(asUser(me)).send(valid);
    const res = await request(app)
      .put(url)
      .set(asUser(me))
      .send({ ...valid, clientId: 'renamed', clientSecret: '', apiToken: '' });
    expect(res.status).toBe(200);
    expect(await getOidcSettings()).toMatchObject({
      clientId: 'renamed',
      clientSecret: 'new-secret',
      apiToken: 'new-token',
    });

    await request(app)
      .put(url)
      .set(asUser(me))
      .send({ ...valid, clientSecret: '', removeApiToken: true });
    expect((await getOidcSettings()).apiToken).toBe('');
    expect(await invitationsEnabled()).toBe(false);
  });

  it('refuses what would lock everybody out: a provider that does not answer, bad values', async () => {
    const me = await owner();
    vi.mocked(discovery).mockRejectedValueOnce(new Error('ENOTFOUND'));
    const res = await request(app).put(url).set(asUser(me)).send(valid);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('https://login.example.org/application/o/klub/');
    expect((await stored())?.serverUrl).toBeUndefined();

    for (const bad of [
      { serverUrl: 'login.example.org' },
      { serverUrl: 'ftp://login.example.org' },
      { providerSlug: 'a/b' },
      { providerSlug: '' },
      { clientId: '' },
      { invitationFlow: 'a b' },
      { postLogoutRedirectUri: 'somewhere' },
    ]) {
      const r = await request(app)
        .put(url)
        .set(asUser(me))
        .send({ ...valid, ...bad });
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await stored())?.serverUrl).toBeUndefined();
  });

  it('cannot save without APP_SECRET_KEY', async () => {
    const me = await owner();
    config.appSecretKey = undefined;
    const res = await request(app).put(url).set(asUser(me)).send(valid);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('APP_SECRET_KEY');
    expect((await request(app).get(url).set(asUser(me))).body.data.canSave).toBe(false);
  });

  it('.env stands in while the saved secrets cannot be read', async () => {
    const me = await owner();
    await request(app).put(url).set(asUser(me)).send(valid);

    // A database copied from a server with another key: .env stands in.
    config.appSecretKey = 'another-key';
    expect(await getOidcSettings()).toMatchObject({
      serverUrl: 'https://auth.test',
      clientSecret: 'test-secret',
      source: 'env',
      unreadable: true,
    });
    expect((await request(app).get(url).set(asUser(me))).body.data).toMatchObject({
      source: 'env',
      unreadable: true,
    });
    config.appSecretKey = 'test-app-secret-key';
  });

  it('with the lines gone from .env, what is saved is all there is', async () => {
    const me = await owner();
    await request(app).put(url).set(asUser(me)).send(valid);
    const env = { ...config.oidcEnv };
    for (const key of Object.keys(config.oidcEnv)) config.oidcEnv[key] = undefined;
    try {
      expect(await getOidcSettings()).toMatchObject({
        serverUrl: 'https://login.example.org',
        clientSecret: 'new-secret',
        source: 'database',
      });
      // An empty secret still keeps the saved one.
      const res = await request(app)
        .put(url)
        .set(asUser(me))
        .send({ ...valid, clientSecret: '', apiToken: '' });
      expect(res.status).toBe(200);
      expect((await getOidcSettings()).clientSecret).toBe('new-secret');
    } finally {
      Object.assign(config.oidcEnv, env);
    }
  });

  it("the first start copies .env's values over, once", async () => {
    await importOidcSettingsFromEnv();
    const oidc = await stored();
    expect(oidc).toMatchObject({ serverUrl: 'https://auth.test', clientId: 'test-client' });
    expect(decryptSecret(oidc.clientSecretEnc)).toBe('test-secret');
    expect((await getOidcSettings()).source).toBe('database');

    await importOidcSettingsFromEnv();
    expect((await ClubSettings.findOne({ key: 'club' })).history).toHaveLength(1);
  });

  it('without APP_SECRET_KEY the first start leaves them in .env', async () => {
    config.appSecretKey = undefined;
    await importOidcSettingsFromEnv();
    expect((await stored())?.serverUrl).toBeUndefined();
    expect((await getOidcSettings()).source).toBe('env');
  });
});
