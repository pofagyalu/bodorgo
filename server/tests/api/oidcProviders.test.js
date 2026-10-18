import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discovery } from 'openid-client';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createUser } from '../helpers/factories.js';
import ClubSettings from '../../src/models/clubSettingsModel.js';
import User from '../../src/models/userModel.js';
import config from '../../src/config.js';
import sendResendEmail from '../../src/utils/resendEmail.js';
import { getActiveProvider } from '../../src/utils/oidcSettings.js';
import { decryptSecret } from '../../src/utils/secretBox.js';

// The providers themselves replaced: each answers at any address unless a
// test says otherwise, and a login comes back with the claims a test set.
const claims = vi.hoisted(() => ({ current: {} }));
vi.mock('openid-client', () => ({
  discovery: vi.fn(async () => ({})),
  randomPKCECodeVerifier: () => 'verifier',
  calculatePKCECodeChallenge: async () => 'challenge',
  randomState: () => 'state',
  randomNonce: () => 'nonce',
  buildAuthorizationUrl: () => new URL('https://somewhere.test/authorize'),
  authorizationCodeGrant: vi.fn(async () => ({
    claims: () => claims.current,
    id_token: 'id-token',
  })),
}));

const loginAs = async (c) => {
  claims.current = c;
  return request(app).get('/auth/callback?code=abc&state=state');
};

const url = '/settings/oidc';
const owner = () => createAdmin({ name: 'Tulaj Dona', canManageRoles: true });
const other = {
  name: 'Másik',
  issuerUrl: 'https://id.example.org/realms/klub',
  clientId: 'klub-app',
  clientSecret: 'other-secret',
  postLogoutRedirectUri: 'https://klub.example.org',
};
// Adds a provider and gives back its id.
const add = async (me, values = other) =>
  (await request(app).post(`${url}/providers`).set(asUser(me)).send(values)).body.data.created;
const activate = (me, provider) =>
  request(app).put(`${url}/active`).set(asUser(me)).send({ provider });

// tests/setup.js: Authentik is https://auth.test, slug bodorgo.
const AUTHENTIK_ISSUER = 'https://auth.test/application/o/bodorgo/';

describe('Beállítások → OIDC szolgáltató: other providers next to Authentik', () => {
  afterEach(() => {
    config.appSecretKey = 'test-app-secret-key';
  });

  it('only the role manager adds, changes, deletes or chooses one', async () => {
    const admin = await createAdmin();
    const calls = [
      request(app).post(`${url}/providers`).send(other),
      request(app).put(`${url}/providers/x`).send(other),
      request(app).delete(`${url}/providers/x`),
      request(app).put(`${url}/active`).send({ provider: 'authentik' }),
    ];
    for (const call of calls) expect((await call.set(asUser(admin))).status).toBe(403);
    expect((await ClubSettings.findOne({ key: 'club' }))?.oidcProviders ?? []).toHaveLength(0);
  });

  it('every change only after identifying again - not on a phone logged in long ago', async () => {
    const me = await owner();
    const id = await add(me);
    const calls = [
      request(app).put(url).send({}),
      request(app).post(`${url}/providers`).send(other),
      request(app)
        .put(`${url}/providers/${id}`)
        .send({ ...other, name: 'Átírt' }),
      request(app).delete(`${url}/providers/${id}`),
      request(app).put(`${url}/active`).send({ provider: id }),
    ];
    for (const call of calls) {
      const res = await call.set(asUser(me, { minutesAgo: 30 }));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('fresh-login-required');
    }
    const [kept] = (await ClubSettings.findOne({ key: 'club' })).oidcProviders;
    expect(kept.name).toBe('Másik');
    expect(
      (
        await request(app)
          .get(url)
          .set(asUser(me, { minutesAgo: 30 }))
      ).status,
    ).toBe(200);
  });

  it('Authentik is the only one, and the active one, to begin with', async () => {
    const res = await request(app)
      .get(url)
      .set(asUser(await owner()));
    expect(res.body.data).toMatchObject({ active: 'authentik', providers: [] });
    expect(await getActiveProvider()).toMatchObject({
      id: 'authentik',
      issuer: AUTHENTIK_ISSUER,
      requireVerifiedEmail: false,
    });
  });

  it('adds one - its secret encrypted, never sent back - and it is not active yet', async () => {
    const me = await owner();
    const res = await request(app).post(`${url}/providers`).set(asUser(me)).send(other);
    expect(res.status).toBe(201);
    const { created, providers, active } = res.body.data;
    expect(active).toBe('authentik');
    expect(providers).toEqual([
      {
        id: created,
        name: 'Másik',
        issuerUrl: 'https://id.example.org/realms/klub',
        clientId: 'klub-app',
        hasClientSecret: true,
        postLogoutRedirectUri: 'https://klub.example.org',
        requireVerifiedEmail: true, // unless said otherwise
        unreadable: false,
      },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('other-secret');
    // It was asked at its issuer address first.
    expect(vi.mocked(discovery).mock.calls.at(-1)[0].href).toBe(other.issuerUrl);

    const saved = await ClubSettings.findOne({ key: 'club' }).select(
      '+oidcProviders.clientSecretEnc',
    );
    expect(JSON.stringify(saved)).not.toContain('other-secret');
    expect(decryptSecret(saved.oidcProviders[0].clientSecretEnc)).toBe('other-secret');
    expect(saved.history.at(-1).change).toBe(
      'OIDC szolgáltató: Új szolgáltató: Másik (https://id.example.org/realms/klub)',
    );
    expect(sendResendEmail).toHaveBeenCalledTimes(1);
    expect((await getActiveProvider()).id).toBe('authentik');
  });

  it('refuses a provider that does not answer, a taken name, bad values', async () => {
    const me = await owner();
    vi.mocked(discovery).mockRejectedValueOnce(new Error('ENOTFOUND'));
    const unreachable = await request(app).post(`${url}/providers`).set(asUser(me)).send(other);
    expect(unreachable.status).toBe(400);
    expect(unreachable.body.message).toContain(other.issuerUrl);

    await add(me);
    for (const bad of [
      { name: 'másik' }, // taken, whatever the case
      { name: 'Authentik' },
      { name: '' },
      { name: 'Új', issuerUrl: 'id.example.org' },
      { name: 'Új', clientId: '' },
      { name: 'Új', clientSecret: '' },
      { name: 'Új', postLogoutRedirectUri: 'somewhere' },
    ]) {
      const res = await request(app)
        .post(`${url}/providers`)
        .set(asUser(me))
        .send({ ...other, ...bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await ClubSettings.findOne({ key: 'club' })).oidcProviders).toHaveLength(1);
  });

  it('changes one; an empty secret keeps its own, and the others keep theirs', async () => {
    const me = await owner();
    const first = await add(me);
    const second = await add(me, { ...other, name: 'Harmadik', clientSecret: 'third-secret' });
    const res = await request(app)
      .put(`${url}/providers/${first}`)
      .set(asUser(me))
      .send({ ...other, name: 'Átnevezett', clientSecret: '', requireVerifiedEmail: false });
    expect(res.status).toBe(200);
    expect(res.body.data.providers.find((p) => p.id === first)).toMatchObject({
      name: 'Átnevezett',
      requireVerifiedEmail: false,
      hasClientSecret: true,
    });

    const saved = await ClubSettings.findOne({ key: 'club' }).select(
      '+oidcProviders.clientSecretEnc',
    );
    const secretOf = (id) =>
      decryptSecret(saved.oidcProviders.find((p) => p.id === id).clientSecretEnc);
    expect(secretOf(first)).toBe('other-secret');
    expect(secretOf(second)).toBe('third-secret');
    expect(saved.history.at(-1).change).toBe(
      'OIDC szolgáltató: Másik: Név: Másik → Átnevezett; Csak megerősített e-mail: igen → nem',
    );

    expect(
      (await request(app).put(`${url}/providers/nincs`).set(asUser(me)).send(other)).status,
    ).toBe(404);
  });

  it("tells what to list among the provider's Redirect URIs - the club's three, on any server", async () => {
    const res = await request(app)
      .get(url)
      .set(asUser(await owner()));
    // The developer's own server, the live API, the live site - and this
    // (test) server's own callback, since it is at another address.
    expect(res.body.data.redirectUris).toEqual([
      'http://localhost:8235/auth/callback',
      'https://api.bodorgo.hu/auth/callback',
      'https://bodorgo.hu',
      res.body.data.redirectUri,
    ]);

    // On a server that is one of the three: just the three.
    const local = await request(app)
      .get(url)
      .set('Host', 'localhost:8235')
      .set(asUser(await User.findOne({ canManageRoles: true })));
    expect(local.body.data.redirectUris).toEqual([
      'http://localhost:8235/auth/callback',
      'https://api.bodorgo.hu/auth/callback',
      'https://bodorgo.hu',
    ]);
  });

  it('makes one active only if it answers; the active one cannot be deleted', async () => {
    const me = await owner();
    const id = await add(me);

    vi.mocked(discovery).mockRejectedValueOnce(new Error('ENOTFOUND'));
    expect((await activate(me, id)).status).toBe(400);
    expect((await getActiveProvider()).id).toBe('authentik');
    expect((await activate(me, 'nincs')).status).toBe(404);

    const res = await activate(me, id);
    expect(res.status).toBe(200);
    expect(res.body.data.active).toBe(id);
    expect(await getActiveProvider()).toMatchObject({
      id,
      name: 'Másik',
      issuer: other.issuerUrl,
      clientSecret: 'other-secret',
      requireVerifiedEmail: true,
    });
    const { history } = await ClubSettings.findOne({ key: 'club' });
    expect(history.at(-1).change).toBe('OIDC szolgáltató: Aktív szolgáltató: Oridzsinátor → Másik');

    expect((await request(app).delete(`${url}/providers/${id}`).set(asUser(me))).status).toBe(400);

    // Back to Authentik - which is always there -, then it can go.
    expect((await activate(me, 'authentik')).body.data.active).toBe('authentik');
    const gone = await request(app).delete(`${url}/providers/${id}`).set(asUser(me));
    expect(gone.status).toBe(200);
    expect(gone.body.data.providers).toEqual([]);
  });

  it('a provider whose secret cannot be read here is not used: Authentik stands in', async () => {
    const me = await owner();
    const id = await add(me);
    await activate(me, id);
    config.appSecretKey = 'another-key';
    expect((await getActiveProvider()).id).toBe('authentik');
    const view = await request(app).get(url).set(asUser(me));
    expect(view.body.data.providers[0]).toMatchObject({ unreadable: true, hasClientSecret: false });
  });
});

describe('logging in through another provider', () => {
  const setUp = async (values = other) => {
    const me = await owner();
    const id = await add(me, values);
    await activate(me, id);
    return id;
  };

  it('the same person, found by their e-mail: the account stays, with one more identity', async () => {
    const known = await createUser({ email: 'tag@test.local', role: 'member' });
    await loginAs({ sub: 'authentik-1', email: 'tag@test.local', name: 'Tag' });
    await setUp();

    const res = await loginAs({
      sub: 'other-7',
      iss: other.issuerUrl,
      email: 'Tag@Test.local',
      email_verified: true,
      name: 'Tag Tamás',
    });
    expect(res.headers.location).not.toContain('error');
    expect(await User.countDocuments({ email: 'tag@test.local' })).toBe(1);
    const user = (await User.findById(known._id)).toObject();
    expect(user).toMatchObject({ role: 'member', name: 'Tag Tamás' });
    expect(user.identities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ issuer: AUTHENTIK_ISSUER, subject: 'authentik-1' }),
        expect.objectContaining({ issuer: other.issuerUrl, subject: 'other-7' }),
      ]),
    );
  });

  it('only a confirmed e-mail gets in - unless the provider is set to take any', async () => {
    const known = await createUser({ email: 'tag@test.local' });
    const id = await setUp();
    for (const email_verified of [false, undefined, 'true']) {
      const res = await loginAs({ sub: 'other-7', email: 'tag@test.local', email_verified });
      expect(res.headers.location).toContain('?error=unverified-email');
    }
    expect((await User.findById(known._id)).lastLoginAt).toBeUndefined();

    const me = await User.findOne({ canManageRoles: true });
    await request(app)
      .put(`${url}/providers/${id}`)
      .set(asUser(me))
      .send({ ...other, clientSecret: '', requireVerifiedEmail: false });
    const res = await loginAs({ sub: 'other-7', email: 'tag@test.local' });
    expect(res.headers.location).not.toContain('error');
  });

  it('Authentik takes an e-mail as it comes, as before', async () => {
    await createUser({ email: 'tag@test.local' });
    const res = await loginAs({ sub: 'a-1', email: 'tag@test.local', email_verified: false });
    expect(res.headers.location).not.toContain('error');
  });

  it('logout goes to the provider the login came from, if it is still the active one', async () => {
    const id = await setUp();
    const member = await createUser();
    const session = (provider) => ({
      'x-test-user': JSON.stringify({ id: String(member._id), id_token: 'id-token', provider }),
    });
    vi.mocked(discovery).mockResolvedValue({
      serverMetadata: () => ({ end_session_endpoint: 'https://id.example.org/logout' }),
    });
    try {
      const res = await request(app).get('/auth/logout').set(session(id));
      expect(res.headers.location).toBe(
        'https://id.example.org/logout?id_token_hint=id-token&post_logout_redirect_uri=https%3A%2F%2Fklub.example.org',
      );
      // A session from before the change (Authentik's token): only the
      // app's own session ends.
      const old = await request(app).get('/auth/logout').set(session(undefined));
      expect(old.headers.location).toBe('http://localhost:4200/');
    } finally {
      vi.mocked(discovery).mockImplementation(async () => ({}));
    }
  });
});
