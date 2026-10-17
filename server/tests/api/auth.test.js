import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember, createUser } from '../helpers/factories.js';
import User from '../../src/models/userModel.js';
import config from '../../src/config.js';
import { migrateUserIdentities } from '../../src/utils/userIdentities.js';

// Authentik (openid-client) replaced: each test says which claims the
// "logged in" person has.
const claims = vi.hoisted(() => ({ current: {} }));
vi.mock('openid-client', () => ({
  discovery: vi.fn(async () => ({})),
  randomPKCECodeVerifier: () => 'verifier',
  calculatePKCECodeChallenge: async () => 'challenge',
  randomState: () => 'state',
  randomNonce: () => 'nonce',
  buildAuthorizationUrl: () => new URL('https://auth.test/authorize?client_id=x'),
  authorizationCodeGrant: vi.fn(async () => ({
    claims: () => claims.current,
    access_token: 'access',
    id_token: 'id-token',
  })),
  fetchUserInfo: vi.fn(async () => ({})),
}));

const loginAs = async (c) => {
  claims.current = c;
  return request(app).get('/auth/callback?code=abc&state=state');
};

// tests/setup.js: INITIAL_ADMIN_USER=owner@test.local.

describe('login - Authentik says who, the app says the role', () => {
  it('starts by redirecting to Authentik', async () => {
    const res = await request(app).get('/auth/login');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('https://auth.test/authorize');
  });

  it('someone an admin added logs in with their e-mail (any case); their role stays', async () => {
    const added = await createUser({ email: 'meglevo@test.local', role: 'member' });
    const res = await loginAs({
      sub: 'sub-2',
      email: 'Meglevo@Test.local',
      name: 'Meglévő Tag',
      bodorgo_role: 'admin', // whatever Authentik says about roles is ignored
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).not.toContain('error');
    const user = await User.findById(added._id);
    expect(user).toMatchObject({ sub: 'sub-2', role: 'member', name: 'Meglévő Tag' });
    expect(user.lastLoginAt).toBeTruthy();
    expect(await User.countDocuments({ email: /meglevo/i })).toBe(1);

    // The next login finds them by their e-mail again; the role still stays.
    await loginAs({ sub: 'sub-2', email: 'meglevo@test.local', name: 'Meglévő Tag' });
    expect((await User.findById(added._id)).role).toBe('member');
  });

  it('knows people by their e-mail alone: a new Authentik id is the same person', async () => {
    // Their Authentik user was deleted and made again: a new id, the same
    // address.
    const known = await createUser({ email: 'ujra@test.local', role: 'member', sub: 'sub-old' });
    const res = await loginAs({ sub: 'sub-new', email: 'ujra@test.local', name: 'Újra Felvett' });
    expect(res.headers.location).not.toContain('error');
    expect(await User.findById(known._id)).toMatchObject({ sub: 'sub-new', role: 'member' });
    expect(await User.countDocuments({ email: 'ujra@test.local' })).toBe(1);
  });

  it('an id that comes with another address is whoever that address belongs to', async () => {
    const first = await createUser({ email: 'egyik@test.local', role: 'admin', sub: 'sub-a' });
    const second = await createUser({ email: 'masik@test.local', role: 'guest' });
    // The Authentik user that was "egyik" now has "masik"'s address: here
    // they are "masik" - a guest -, not the admin the id used to be.
    const res = await loginAs({ sub: 'sub-a', email: 'masik@test.local', name: 'Másik' });
    expect(res.headers.location).not.toContain('error');
    expect(await User.findById(second._id)).toMatchObject({ sub: 'sub-a', role: 'guest' });
    // The id is off the record it was on; that account is untouched otherwise.
    const before = await User.findById(first._id);
    expect(before.sub).toBeUndefined();
    expect(before).toMatchObject({ email: 'egyik@test.local', role: 'admin' });
  });

  it('refuses a known id that comes with an address nobody was added with', async () => {
    const known = await createUser({ email: 'regi@test.local', role: 'member', sub: 'sub-k' });
    // Their address was changed in Authentik: the app doesn't know the new one.
    const res = await loginAs({ sub: 'sub-k', email: 'uj-cim@test.local', name: 'Régi Tag' });
    expect(res.headers.location).toContain('?error=not-invited');
    expect(await User.findById(known._id)).toMatchObject({
      email: 'regi@test.local',
      sub: 'sub-k',
    });
    // And without any address at all.
    expect((await loginAs({ sub: 'sub-k', name: 'Régi Tag' })).headers.location).toContain(
      '?error=not-invited',
    );
  });

  it('refuses anyone not added in the app - no account is created', async () => {
    const res = await loginAs({ sub: 'sub-3', email: 'idegen@test.local', name: 'Idegen' });
    expect(res.headers.location).toContain('?error=not-invited');
    expect(await User.findOne({ sub: 'sub-3' })).toBeNull();
    expect(await User.findOne({ email: 'idegen@test.local' })).toBeNull();
  });

  it('the INITIAL_ADMIN_USER can always get in: a fresh installation creates them as the role manager', async () => {
    const res = await loginAs({ sub: 'sub-owner', email: 'Owner@test.local', name: 'Tulaj Dona' });
    expect(res.headers.location).not.toContain('error');
    expect(await User.findOne({ sub: 'sub-owner' })).toMatchObject({
      role: 'admin',
      canManageRoles: true,
      name: 'Tulaj Dona',
    });
  });

  it("the role-manager flag is the INITIAL_ADMIN_USER's alone - checked at every login", async () => {
    // An account that somehow has it, logged in to with another e-mail.
    const other = await createAdmin({ canManageRoles: true, email: 'mas@test.local' });
    await loginAs({ sub: 'sub-mas', email: 'mas@test.local', name: 'Más Admin' });
    expect(await User.findById(other._id)).toMatchObject({ role: 'admin', canManageRoles: false });
  });

  it('a suspended person is refused at login - until an admin restores them', async () => {
    const admin = await createAdmin();
    const member = await createMember({
      email: 'felfuggesztett@test.local',
      name: 'Felfüggesztett',
    });
    await request(app).delete(`/users/${member._id}`).set(asUser(admin));

    const refused = await loginAs({ sub: 'sub-f', email: 'felfuggesztett@test.local', name: 'F' });
    expect(refused.headers.location).toContain('?error=suspended');
    // The landing page says why - the login page is the emergency login's only.
    expect(refused.headers.location).not.toContain('login');
    expect((await User.findById(member._id)).lastLoginAt).toBeFalsy();

    await request(app).patch(`/users/${member._id}/restore`).set(asUser(admin));
    const back = await loginAs({ sub: 'sub-f', email: 'felfuggesztett@test.local', name: 'F' });
    expect(back.headers.location).not.toContain('error');
    expect((await User.findById(member._id)).lastLoginAt).toBeTruthy();
  });

  it('answers "Login failed" when Authentik rejects the code', async () => {
    const { authorizationCodeGrant } = await import('openid-client');
    vi.mocked(authorizationCodeGrant).mockRejectedValueOnce(new Error('invalid_grant'));
    const res = await request(app).get('/auth/callback?code=bad');
    expect(res.status).toBe(500);
    expect(res.text).toBe('Login failed');
  });
});

describe('who am I', () => {
  it('logged out', async () => {
    expect((await request(app).get('/auth/me')).body).toEqual({ loggedIn: false });
  });

  it('logged in: fresh role, the role-manager flag and photo info from the database', async () => {
    const member = await createMember({ photoUpdatedAt: new Date() });
    const res = await request(app).get('/auth/me').set(asUser(member));
    expect(res.body).toMatchObject({
      loggedIn: true,
      id: String(member._id),
      role: 'member',
      canManageRoles: false,
    });
    expect(res.body.photoUpdatedAt).toBeTruthy();
    const owner = await createAdmin({ canManageRoles: true });
    expect((await request(app).get('/auth/me').set(asUser(owner))).body.canManageRoles).toBe(true);
  });

  it('a suspended user is logged out, and refused on every request', async () => {
    const member = await createMember({ retired: true });
    expect((await request(app).get('/auth/me').set(asUser(member))).body).toEqual({
      loggedIn: false,
    });
    const res = await request(app).get('/tours').set(asUser(member));
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('A fiókod fel van függesztve.');
  });

  it('a deleted user is logged out', async () => {
    const member = await createMember();
    await User.deleteOne({ _id: member._id });
    expect((await request(app).get('/auth/me').set(asUser(member))).body).toEqual({
      loggedIn: false,
    });
  });

  it("logout redirects to Authentik's end-session page", async () => {
    const member = await createMember();
    const res = await request(app)
      .get('/auth/logout')
      .set({
        'x-test-user': JSON.stringify({ id: String(member._id), id_token: 'id-token' }),
      });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(
      'https://auth.test/application/o/bodorgo/end-session/?id_token_hint=id-token',
    );
    // Logged in with a password: there is no provider to log out of.
    const local = await request(app).get('/auth/logout').set(asUser(member));
    expect(local.headers.location).toBe('http://localhost:4200/');
  });
});

const ISSUER = 'https://auth.test/application/o/bodorgo/';

describe('identities - who someone is at each provider', () => {
  it('a login notes the id under its provider; another provider is one more line', async () => {
    const added = await createUser({ email: 'ki@test.local' });
    await loginAs({ sub: 'sub-1', email: 'ki@test.local', name: 'Ki' });
    expect((await User.findById(added._id)).toObject().identities).toMatchObject([
      { issuer: ISSUER, subject: 'sub-1' },
    ]);

    // The same person through another provider (the token names it).
    await loginAs({ sub: 'other-9', iss: 'https://other.test/', email: 'ki@test.local' });
    // And with a new id at the first: one id per provider, the newest.
    await loginAs({ sub: 'sub-2', email: 'ki@test.local', name: 'Ki' });
    const user = (await User.findById(added._id)).toObject();
    expect(user.identities).toHaveLength(2);
    expect(user.identities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ issuer: 'https://other.test/', subject: 'other-9' }),
        expect.objectContaining({ issuer: ISSUER, subject: 'sub-2' }),
      ]),
    );
  });

  it("an id that comes with another address moves to that address's account", async () => {
    const first = await createUser({ email: 'egy@test.local' });
    const second = await createUser({ email: 'ketto@test.local' });
    await loginAs({ sub: 'sub-a', email: 'egy@test.local' });
    await loginAs({ sub: 'sub-a', email: 'ketto@test.local' });
    expect((await User.findById(first._id)).identities).toHaveLength(0);
    expect((await User.findById(second._id)).toObject().identities).toMatchObject([
      { issuer: ISSUER, subject: 'sub-a' },
    ]);
  });

  it("at start, everyone's old id becomes their identity at the provider in use", async () => {
    const { discovery } = await import('openid-client');
    vi.mocked(discovery).mockResolvedValueOnce({ serverMetadata: () => ({ issuer: ISSUER }) });
    const old = await createUser({ sub: 'sub-old' });
    const child = await createUser({ email: undefined });
    // Another client secret, so the provider is asked again.
    config.oidcEnv.clientSecret = 'another-secret';
    await migrateUserIdentities();
    config.oidcEnv.clientSecret = 'test-secret';
    expect((await User.findById(old._id)).toObject().identities).toMatchObject([
      { issuer: ISSUER, subject: 'sub-old' },
    ]);
    expect((await User.findById(child._id)).identities).toHaveLength(0);
  });
});

describe('local login - e-mail and password (LOCAL_LOGIN=true)', () => {
  const login = (body) => request(app).post('/auth/local-login').send(body);

  it('is off by default', async () => {
    expect((await request(app).get('/auth/mode')).body).toEqual({ localLogin: false });
    expect((await login({ email: 'owner@test.local', password: 'x' })).status).toBe(404);
  });

  it('is off whatever INITIAL_ADMIN_PASSWORD says', async () => {
    config.initialAdminPassword = 'a-long-initial-password';
    const res = await login({ email: 'owner@test.local', password: 'a-long-initial-password' });
    config.initialAdminPassword = null;
    expect(res.status).toBe(404);
    expect(await User.countDocuments()).toBe(0);
  });

  describe('switched on', () => {
    const body = { email: 'owner@test.local', password: 'a-long-initial-password' };

    beforeEach(() => {
      config.localLogin = true;
      config.initialAdminPassword = 'a-long-initial-password';
    });
    afterEach(() => {
      config.localLogin = false;
      config.initialAdminPassword = null;
    });

    it('a fresh installation: the two .env lines let the role manager in, with every right', async () => {
      expect((await request(app).get('/auth/mode')).body).toEqual({ localLogin: true });
      // Every "log in" button leads to the login page's form, not the provider.
      const start = await request(app).get('/auth/login');
      expect(start.status).toBe(302);
      expect(start.headers.location).toBe('http://localhost:4200/login');
      const res = await login({ ...body, email: ' Owner@Test.local ' });
      expect(res.status).toBe(200);
      const owner = await User.findOne({ email: 'owner@test.local' }).select('+password');
      expect(owner).toMatchObject({ role: 'admin', canManageRoles: true });
      expect(owner.lastLoginAt).toBeTruthy();
      // The app keeps no password: it is only ever in .env.
      expect(owner.password).toBeUndefined();
    });

    it('a restored backup: it is their own account they get into - no second one, no password kept', async () => {
      const known = await createUser({ email: 'owner@test.local', role: 'guest', sub: 'sub-o' });
      expect((await login(body)).status).toBe(200);
      expect(await User.countDocuments({ email: 'owner@test.local' })).toBe(1);
      const owner = await User.findById(known._id).select('+password');
      expect(owner).toMatchObject({ role: 'admin', canManageRoles: true, sub: 'sub-o' });
      expect(owner.password).toBeUndefined();
    });

    it('nobody else gets in, and nothing but the password in .env opens it', async () => {
      const admin = await createAdmin({ password: 'their-own-password' });
      for (const attempt of [
        { ...body, password: 'wrong-password' },
        { ...body, password: '' },
        { ...body, email: 'nobody@test.local' },
        { email: admin.email, password: 'a-long-initial-password' },
        { email: admin.email, password: 'their-own-password' },
        {},
      ]) {
        const res = await login(attempt);
        expect(res.status, JSON.stringify(attempt)).toBe(401);
        expect(res.body.message).toBe('Hibás e-mail cím vagy jelszó.');
      }
      expect(await User.findOne({ email: 'owner@test.local' })).toBeNull();
    });

    it('a missing or short INITIAL_ADMIN_PASSWORD lets nobody in', async () => {
      config.initialAdminPassword = 'short';
      expect((await login({ ...body, password: 'short' })).status).toBe(401);
      config.initialAdminPassword = null;
      expect((await login({ ...body, password: '' })).status).toBe(401);
    });
  });
});
