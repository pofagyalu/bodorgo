import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember } from '../helpers/factories.js';
import User from '../../src/models/userModel.js';

describe('usernames set by an admin', () => {
  it('lists everyone not suspended, and saves many at once', async () => {
    const admin = await createAdmin({ name: 'Admin' });
    const anna = await createMember({ name: 'Kiss Anna' });
    const bela = await createMember({ name: 'Nagy Béla', username: 'bela' });
    await createMember({ name: 'Felfüggesztett', retired: true });

    const list = await request(app).get('/users/usernames').set(asUser(admin));
    expect(list.body.data.users.map((u) => u.name)).toEqual(['Admin', 'Kiss Anna', 'Nagy Béla']);

    const res = await request(app)
      .put('/users/usernames')
      .set(asUser(admin))
      .send({
        items: [
          { id: anna._id, username: 'Anna' },
          { id: bela._id, username: '' },
        ],
      });
    expect(res.body.data.updated).toBe(2);
    expect((await User.findById(anna._id)).username).toBe('Anna');
    expect((await User.findById(bela._id)).username).toBeUndefined();

    expect((await request(app).get('/users/usernames').set(asUser(anna))).status).toBe(403);
  });

  it('two people can swap names in one save', async () => {
    const admin = await createAdmin();
    const a = await createMember({ username: 'egy' });
    const b = await createMember({ username: 'ketto' });
    const res = await request(app)
      .put('/users/usernames')
      .set(asUser(admin))
      .send({
        items: [
          { id: a._id, username: 'ketto' },
          { id: b._id, username: 'egy' },
        ],
      });
    expect(res.status).toBe(200);
    expect((await User.findById(a._id)).username).toBe('ketto');
  });

  it('saves nothing when a row is wrong, and says which one', async () => {
    const admin = await createAdmin();
    const a = await createMember();
    const b = await createMember();
    const c = await createMember();
    await createMember({ username: 'Zoli' });

    const res = await request(app)
      .put('/users/usernames')
      .set(asUser(admin))
      .send({
        items: [
          { id: a._id, username: 'zoli' }, // taken by someone else (ignoring case)
          { id: b._id, username: 'Bé la' }, // a space
          { id: c._id, username: 'rendben' },
        ],
      });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.errors).sort()).toEqual([String(a._id), String(b._id)].sort());
    expect((await User.findById(c._id)).username).toBeUndefined(); // nothing saved

    const twice = await request(app)
      .put('/users/usernames')
      .set(asUser(admin))
      .send({
        items: [
          { id: a._id, username: 'Same' },
          { id: b._id, username: 'same' },
        ],
      });
    expect(Object.keys(twice.body.errors)).toHaveLength(2);
  });

  it('accented names are fine - and "Béla" and "Bela" are the same name', async () => {
    const admin = await createAdmin();
    const bela = await createMember();
    const other = await createMember();
    expect(
      (await request(app).patch(`/users/${bela._id}`).set(asUser(admin)).send({ username: 'Béla' }))
        .status,
    ).toBe(200);
    expect((await User.findById(bela._id)).username).toBe('Béla');

    const clash = await request(app)
      .patch(`/users/${other._id}`)
      .set(asUser(admin))
      .send({ username: 'BELA' });
    expect(clash.status).toBe(400);
    const bulk = await request(app)
      .put('/users/usernames')
      .set(asUser(admin))
      .send({ items: [{ id: other._id, username: 'bela' }] });
    expect(bulk.status).toBe(400);
  });

  it("an admin sets one person's username; the person can still change it; clashes ignore case", async () => {
    const admin = await createAdmin();
    const member = await createMember({ lastLoginAt: new Date() });
    await createMember({ username: 'Foglalt' });

    const set = await request(app)
      .patch(`/users/${member._id}`)
      .set(asUser(admin))
      .send({ username: 'Zoltan' });
    expect(set.status).toBe(200);
    expect(
      (
        await request(app)
          .patch(`/users/${member._id}`)
          .set(asUser(admin))
          .send({ username: 'foglalt' })
      ).status,
    ).toBe(400);

    // Their own change still works - but not onto a taken name.
    expect(
      (await request(app).patch('/users/updateMe').set(asUser(member)).send({ username: 'Zolika' }))
        .status,
    ).toBe(200);
    expect((await User.findById(member._id)).username).toBe('Zolika');
    expect(
      (
        await request(app)
          .patch('/users/updateMe')
          .set(asUser(member))
          .send({ username: 'FOGLALT' })
      ).status,
    ).toBe(400);
  });
});
