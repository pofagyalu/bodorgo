import request from 'supertest';
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import {
  createAdmin,
  createGuest,
  createMember,
  createReservation,
  createTour,
} from '../helpers/factories.js';
import User from '../../src/models/userModel.js';
import Reservation from '../../src/models/reservationModel.js';
import { computeAge, resolveFamilyId } from '../../src/controllers/userController.js';

describe('computeAge', () => {
  it('counts a birthday only once it has happened that year', () => {
    expect(computeAge('2000-06-15', '2024-06-14')).toBe(23);
    expect(computeAge('2000-06-15', '2024-06-15')).toBe(24);
    expect(computeAge(null)).toBeNull();
  });
});

describe('resolveFamilyId', () => {
  it('accepts a full id, a unique ending, and rejects unknown or ambiguous ones', async () => {
    const famA = new mongoose.Types.ObjectId('aaaaaaaaaaaaaaaaaaaa1234');
    const famB = new mongoose.Types.ObjectId('bbbbbbbbbbbbbbbbbbbb5234');
    await createMember({ familyId: famA });
    await createMember({ familyId: famB });
    expect(await resolveFamilyId(String(famA))).toBe(String(famA));
    expect(await resolveFamilyId('a1234')).toBe(String(famA));
    await expect(resolveFamilyId('zzzz')).rejects.toThrow('Nem található');
    await expect(resolveFamilyId('234')).rejects.toThrow('Több család');
  });
});

describe('user lists', () => {
  it('lets admins and members list users, not guests', async () => {
    const guest = await createGuest();
    const member = await createMember({ birthday: new Date('1990-01-01') });
    const admin = await createAdmin();
    expect((await request(app).get('/users').set(asUser(guest))).status).toBe(403);
    const asMember = await request(app).get('/users').set(asUser(member));
    expect(asMember.status).toBe(200);
    // A member sees ages, never raw birthdays, and no tour counts.
    const me = asMember.body.data.users.find((u) => u._id === String(member._id));
    expect(me.birthday).toBeUndefined();
    expect(me.age).toBeGreaterThan(30);
    const asAdmin = await request(app).get('/users').set(asUser(admin));
    expect(asAdmin.body.data.users[0]).toHaveProperty('toursAttended');
  });

  it('the members list has age, tour count, email and photo version', async () => {
    const member = await createMember({
      birthday: new Date('1990-01-01'),
      photoUpdatedAt: new Date(),
    });
    await createReservation(await createTour(), [member]);
    const res = await request(app).get('/membership/users').set(asUser(member));
    expect(res.status).toBe(200);
    const row = res.body.data.users.find((u) => u._id === String(member._id));
    expect(row).toMatchObject({ toursAttended: 1, email: member.email });
    expect(row.photoUpdatedAt).toBeTruthy();
    expect(row.birthday).toBeUndefined();
  });
});

describe('my own profile', () => {
  it('returns my profile with tour count and photo info', async () => {
    const member = await createMember({ username: 'teszt.elek' });
    await createReservation(await createTour(), [member]);
    const res = await request(app).get('/users/me').set(asUser(member));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      _id: String(member._id),
      username: 'teszt.elek',
      toursAttended: 1,
      photoUpdatedAt: null,
    });
  });

  it('updates only the allowed fields', async () => {
    const member = await createMember();
    const res = await request(app)
      .patch('/users/updateMe')
      .set(asUser(member))
      .send({ username: '  uj.nev  ', wantsEmailNotifications: false, role: 'admin' });
    expect(res.status).toBe(200);
    const saved = await User.findById(member._id);
    expect(saved.username).toBe('uj.nev');
    expect(saved.wantsEmailNotifications).toBe(false);
    expect(saved.role).toBe('member'); // not changeable here
    expect(
      (await request(app).patch('/users/updateMe').set(asUser(member)).send({ password: 'x' }))
        .status,
    ).toBe(400);
  });

  it('lists my tours and my family', async () => {
    const member = await createMember();
    const kid = await createMember({ familyId: member.familyId, name: 'Gyerek' });
    const tour = await createTour();
    await createReservation(tour, [member, kid]);
    const tours = await request(app).get('/users/me/attendance').set(asUser(member));
    expect(tours.body.data.tours).toHaveLength(1);
    expect(tours.body.data.tours[0]).toMatchObject({ paid: false, paymentId: null });
    const family = await request(app).get('/users/me/family').set(asUser(member));
    expect(family.body.data.members.map((m) => m.name)).toEqual(['Gyerek']);
    const loner = await createMember({ familyId: undefined });
    await User.updateOne({ _id: loner._id }, { $unset: { familyId: 1 } });
    expect(
      (await request(app).get('/users/me/family').set(asUser(loner))).body.data.members,
    ).toEqual([]);
  });
});

describe('admin user management', () => {
  it('creates, reads and edits a user', async () => {
    const admin = await createAdmin();
    expect((await request(app).post('/users').set(asUser(admin)).send({})).status).toBe(400);
    const created = await request(app)
      .post('/users')
      .set(asUser(admin))
      .send({ name: 'Új Ember', email: 'UJ@Test.local', role: 'guest', memberSince: 2021 });
    expect(created.status).toBe(201);
    const id = created.body.data.user._id;
    expect(created.body.data.user.email).toBe('uj@test.local');

    const read = await request(app).get(`/users/${id}`).set(asUser(admin));
    expect(read.body.data.user).toMatchObject({ name: 'Új Ember', toursAttended: 0 });

    const edited = await request(app)
      .patch(`/users/${id}`)
      .set(asUser(admin))
      .send({ role: 'member', gender: 'nő' });
    expect(edited.status).toBe(200);
    expect(edited.body.data.user).toMatchObject({ role: 'member', gender: 'nő' });
    expect(
      (await request(app).patch(`/users/${id}`).set(asUser(admin)).send({ role: 'king' })).status,
    ).toBe(400);
    expect(
      (await request(app).post('/users').set(asUser(admin)).send({ name: 'X', role: 'king' }))
        .status,
    ).toBe(400);
  });

  it('404s for unknown users and is admin-only', async () => {
    const admin = await createAdmin();
    const member = await createMember();
    const unknown = '000000000000000000000000';
    expect((await request(app).get(`/users/${unknown}`).set(asUser(admin))).status).toBe(404);
    expect((await request(app).patch(`/users/${unknown}`).set(asUser(admin)).send({})).status).toBe(
      404,
    );
    expect((await request(app).get(`/users/${member._id}`).set(asUser(member))).status).toBe(403);
  });

  it('suspends (never deletes) and restores a user', async () => {
    const admin = await createAdmin();
    const member = await createMember();
    const del = await request(app).delete(`/users/${member._id}`).set(asUser(admin));
    expect(del.status).toBe(200);
    let saved = await User.findById(member._id);
    expect(saved.retired).toBe(true);
    expect(saved.retiredAt).toBeTruthy();
    await request(app).patch(`/users/${member._id}/restore`).set(asUser(admin));
    saved = await User.findById(member._id);
    expect(saved.retired).toBe(false);
    expect(saved.retiredAt).toBeUndefined();
    expect(
      (await request(app).delete('/users/000000000000000000000000').set(asUser(admin))).status,
    ).toBe(404);
    expect(
      (await request(app).patch('/users/000000000000000000000000/restore').set(asUser(admin)))
        .status,
    ).toBe(404);
  });

  it('joins users into one family', async () => {
    const admin = await createAdmin();
    const a = await createMember();
    const b = await createMember();
    await User.updateMany({ _id: { $in: [a._id, b._id] } }, { $unset: { familyId: 1 } });
    expect(
      (
        await request(app)
          .post('/users/join-family')
          .set(asUser(admin))
          .send({ userIds: [a._id] })
      ).status,
    ).toBe(400);
    const res = await request(app)
      .post('/users/join-family')
      .set(asUser(admin))
      .send({ userIds: [String(a._id), String(b._id)] });
    expect(res.status).toBe(200);
    const [ua, ub] = await Promise.all([User.findById(a._id), User.findById(b._id)]);
    expect(String(ua.familyId)).toBe(String(ub.familyId));
  });

  it('refuses to merge two different existing families', async () => {
    const admin = await createAdmin();
    const a = await createMember();
    const b = await createMember();
    const res = await request(app)
      .post('/users/join-family')
      .set(asUser(admin))
      .send({ userIds: [String(a._id), String(b._id)] });
    expect(res.status).toBe(400);
  });
});

describe('a cancelled registration', () => {
  it('disappears from my tours', async () => {
    const member = await createMember();
    const r = await createReservation(await createTour(), [member]);
    await Reservation.deleteOne({ _id: r._id });
    const res = await request(app).get('/users/me/attendance').set(asUser(member));
    expect(res.body.data.tours).toEqual([]);
  });
});
