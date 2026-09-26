import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createMember } from '../helpers/factories.js';
import User from '../../src/models/userModel.js';
import { roleFromClaim } from '../../src/controllers/authOidcController.js';

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

describe('roles from Authentik', () => {
  it('accepts only admin, member and guest', () => {
    expect(roleFromClaim('admin')).toBe('admin');
    expect(roleFromClaim('guest')).toBe('guest');
    expect(roleFromClaim('superuser')).toBeNull();
    expect(roleFromClaim(undefined)).toBeNull();
  });
});

describe('login', () => {
  it('starts by redirecting to Authentik', async () => {
    const res = await request(app).get('/auth/login');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('https://auth.test/authorize');
  });

  it('creates a new user on first login, with the role from Authentik', async () => {
    const res = await loginAs({ sub: 'sub-1', email: 'uj@test.local', name: 'Új Tag', bodorgo_role: 'member' });
    expect(res.status).toBe(302);
    const user = await User.findOne({ sub: 'sub-1' });
    expect(user).toMatchObject({ email: 'uj@test.local', role: 'member' });
    expect(user.lastLoginAt).toBeTruthy();
  });

  it('links an existing record (added by an admin) by email on first login', async () => {
    const existing = await createMember({ email: 'meglevo@test.local', role: 'guest' });
    await loginAs({ sub: 'sub-2', email: 'meglevo@test.local', name: 'Meglévő', bodorgo_role: 'admin' });
    const user = await User.findById(existing._id);
    expect(user).toMatchObject({ sub: 'sub-2', role: 'admin', name: 'Meglévő' });
    expect(await User.countDocuments({ email: 'meglevo@test.local' })).toBe(1);
  });

  it('refuses a login without a valid role', async () => {
    const res = await loginAs({ sub: 'sub-3', email: 'x@test.local', bodorgo_role: 'nobody' });
    expect(res.headers.location).toContain('login?error=no-role');
    expect(await User.findOne({ sub: 'sub-3' })).toBeNull();
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

  it('logged in: fresh role and photo info from the database', async () => {
    const member = await createMember({ photoUpdatedAt: new Date() });
    const res = await request(app).get('/auth/me').set(asUser(member));
    expect(res.body).toMatchObject({ loggedIn: true, id: String(member._id), role: 'member' });
    expect(res.body.photoUpdatedAt).toBeTruthy();
  });

  it('a deleted user is logged out', async () => {
    const member = await createMember();
    await User.deleteOne({ _id: member._id });
    expect((await request(app).get('/auth/me').set(asUser(member))).body).toEqual({ loggedIn: false });
  });

  it('logout redirects to Authentik\'s end-session page', async () => {
    const res = await request(app).get('/auth/logout').set(asUser(await createMember()));
    expect(res.status).toBe(302);
  });
});
