import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember, createUser } from '../helpers/factories.js';
import User from '../../src/models/userModel.js';
import { syncRoleManager } from '../../src/utils/roleManager.js';

// tests/setup.js: INITIAL_ADMIN_USER=owner@test.local.

describe('the role manager (INITIAL_ADMIN_USER)', () => {
  it('at start: the named user gets the flag and admin, everyone else loses the flag', async () => {
    const owner = await createUser({ email: 'OWNER@test.local', role: 'member' });
    const former = await createAdmin({ canManageRoles: true });
    await syncRoleManager();
    expect(await User.findById(owner._id)).toMatchObject({ role: 'admin', canManageRoles: true });
    expect((await User.findById(former._id)).canManageRoles).toBe(false);
    // The former owner is still an admin - only the flag moved.
    expect((await User.findById(former._id)).role).toBe('admin');
  });

  it('without an account yet, nothing breaks (their first login creates it)', async () => {
    await createAdmin({ canManageRoles: true });
    await syncRoleManager();
    expect(await User.countDocuments({ canManageRoles: true })).toBe(0);
  });
});

describe('changing roles', () => {
  it('only the role manager changes a role; other admins edit everything else', async () => {
    const owner = await createAdmin({ canManageRoles: true });
    const admin = await createAdmin();
    const guest = await createUser({ role: 'guest' });
    const patch = (by, body) =>
      request(app).patch(`/users/${guest._id}`).set(asUser(by)).send(body);

    const refused = await patch(admin, { role: 'member' });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toContain('szerepkör-kezelő');
    // The same role sent back with other changes is fine (the edit form
    // always sends it).
    expect((await patch(admin, { role: 'guest', name: 'Új Név' })).status).toBe(200);

    expect((await patch(owner, { role: 'member' })).status).toBe(200);
    expect((await User.findById(guest._id)).role).toBe('member');
  });

  it('the role manager cannot change their own role', async () => {
    const owner = await createAdmin({ canManageRoles: true });
    const res = await request(app)
      .patch(`/users/${owner._id}`)
      .set(asUser(owner))
      .send({ role: 'member' });
    expect(res.status).toBe(400);
    expect((await User.findById(owner._id)).role).toBe('admin');
  });

  it("adding someone: others add a guest; only the role manager gives another role; the flag can't be set", async () => {
    const owner = await createAdmin({ canManageRoles: true });
    const admin = await createAdmin();
    const add = (by, body) => request(app).post('/users').set(asUser(by)).send(body);

    expect((await add(admin, { name: 'Vendég', role: 'guest' })).status).toBe(201);
    expect((await add(admin, { name: 'Vendég 2' })).body.data.user.role).toBe('guest');
    expect((await add(admin, { name: 'Tag', role: 'member' })).status).toBe(403);
    const byOwner = await add(owner, { name: 'Tag', role: 'member', canManageRoles: true });
    expect(byOwner.status).toBe(201);
    expect(await User.findById(byOwner.body.data.user._id)).toMatchObject({
      role: 'member',
      canManageRoles: false,
    });
    // Not through an edit either.
    await request(app)
      .patch(`/users/${admin._id}`)
      .set(asUser(owner))
      .send({ canManageRoles: true });
    expect((await User.findById(admin._id)).canManageRoles).toBe(false);
    expect((await add(await createMember(), { name: 'x' })).status).toBe(403);
  });
});
