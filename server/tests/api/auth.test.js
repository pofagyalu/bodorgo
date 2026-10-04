import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember, createUser } from '../helpers/factories.js';
import User from '../../src/models/userModel.js';

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
    expect(res.headers.location).toContain('login?error=not-invited');
    expect(await User.findById(known._id)).toMatchObject({
      email: 'regi@test.local',
      sub: 'sub-k',
    });
    // And without any address at all.
    expect((await loginAs({ sub: 'sub-k', name: 'Régi Tag' })).headers.location).toContain(
      'login?error=not-invited',
    );
  });

  it('refuses anyone not added in the app - no account is created', async () => {
    const res = await loginAs({ sub: 'sub-3', email: 'idegen@test.local', name: 'Idegen' });
    expect(res.headers.location).toContain('login?error=not-invited');
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

  it('a deleted user is logged out', async () => {
    const member = await createMember();
    await User.deleteOne({ _id: member._id });
    expect((await request(app).get('/auth/me').set(asUser(member))).body).toEqual({
      loggedIn: false,
    });
  });

  it("logout redirects to Authentik's end-session page", async () => {
    const res = await request(app)
      .get('/auth/logout')
      .set(asUser(await createMember()));
    expect(res.status).toBe(302);
  });
});
