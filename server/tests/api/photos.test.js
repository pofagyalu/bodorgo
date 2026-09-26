import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember } from '../helpers/factories.js';
import User from '../../src/models/userModel.js';

// A tiny "JPEG": only the magic bytes matter to the server's check.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const upload = (url, user, buffer = JPEG, type = 'image/jpeg') =>
  request(app)
    .put(url)
    .set(asUser(user))
    .attach('file', buffer, { filename: 'photo.jpg', contentType: type });

describe('profile photos', () => {
  it('uploads my own photo and serves it to logged-in users only', async () => {
    const me = await createMember();
    const res = await upload('/users/me/photo', me);
    expect(res.status).toBe(200);
    expect(res.body.data.photoSetBy).toBe('self');
    const photo = await request(app)
      .get(`/users/${me._id}/photo`)
      .set(asUser(await createMember()));
    expect(photo.status).toBe(200);
    expect(photo.headers['content-type']).toContain('image/jpeg');
    expect(photo.headers['cache-control']).toContain('immutable');
    expect((await request(app).get(`/users/${me._id}/photo`)).status).toBe(401);
  });

  it('rejects anything that is not really a JPEG', async () => {
    const me = await createMember();
    expect((await upload('/users/me/photo', me, PNG, 'image/png')).status).toBe(400);
    expect((await upload('/users/me/photo', me, PNG, 'image/jpeg')).status).toBe(400);
    expect((await request(app).put('/users/me/photo').set(asUser(me))).status).toBe(400);
  });

  it('removes my photo', async () => {
    const me = await createMember();
    await upload('/users/me/photo', me);
    const res = await request(app).delete('/users/me/photo').set(asUser(me));
    expect(res.body.data).toEqual({ photoUpdatedAt: null, photoSetBy: 'self' });
    expect((await request(app).get(`/users/${me._id}/photo`).set(asUser(me))).status).toBe(404);
  });

  it("an admin can set someone's photo until that person sets their own", async () => {
    const admin = await createAdmin();
    const member = await createMember();
    const byAdmin = await upload(`/users/${member._id}/photo`, admin);
    expect(byAdmin.body.data.photoSetBy).toBe('admin');
    await upload('/users/me/photo', member);
    expect((await upload(`/users/${member._id}/photo`, admin)).status).toBe(403);
    expect(
      (await request(app).delete(`/users/${member._id}/photo`).set(asUser(admin))).status,
    ).toBe(403);
  });

  it('an admin editing their own photo counts as setting it themselves', async () => {
    const admin = await createAdmin();
    await upload(`/users/${admin._id}/photo`, admin);
    expect((await User.findById(admin._id)).photoSetBy).toBe('self');
    const del = await request(app).delete(`/users/${admin._id}/photo`).set(asUser(admin));
    expect(del.status).toBe(200);
  });

  it("only admins may change someone else's photo; 404 for unknown users", async () => {
    const member = await createMember();
    expect((await upload(`/users/${member._id}/photo`, await createMember())).status).toBe(403);
    expect(
      (await upload('/users/000000000000000000000000/photo', await createAdmin())).status,
    ).toBe(404);
  });
});
