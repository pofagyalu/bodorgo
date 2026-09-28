import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember } from '../helpers/factories.js';
import User from '../../src/models/userModel.js';
import { getClubSettings } from '../../src/utils/clubSettings.js';
import { budapestToday, fillMessage, givenName, isBirthday } from '../../src/utils/birthday.js';

// A birthday as the app stores it: that day's midnight UTC.
const born = (yyyyMmDd) => new Date(`${yyyyMmDd}T00:00:00.000Z`);
// Today's month-day in Budapest, in some earlier year.
const bornToday = (year = 1990) => born(`${year}${budapestToday().slice(4)}`);

describe('isBirthday', () => {
  it('matches the month and day, whatever the year', () => {
    expect(isBirthday(born('1976-08-07'), '2026-08-07')).toBe(true);
    expect(isBirthday(born('1976-08-07'), '2026-08-08')).toBe(false);
    expect(isBirthday(born('1976-08-07'), '2026-07-08')).toBe(false);
    expect(isBirthday(null, '2026-08-07')).toBe(false);
  });

  it('celebrates 29 February on the 28th in other years', () => {
    expect(isBirthday(born('2004-02-29'), '2026-02-28')).toBe(true);
    expect(isBirthday(born('2004-02-29'), '2028-02-29')).toBe(true);
    expect(isBirthday(born('2004-02-29'), '2028-02-28')).toBe(false);
    expect(isBirthday(born('2004-02-28'), '2026-02-28')).toBe(true);
  });

  it('greets by the given name - the last one in a Hungarian name', () => {
    expect(givenName({ name: 'Nagy Zoltán' })).toBe('Zoltán');
    expect(givenName({ name: 'Nagy Zoltán', firstName: 'Zoli' })).toBe('Zoli');
    expect(fillMessage('Boldog születésnapot, {név}! 🎂', { name: 'Kiss Anna' })).toBe(
      'Boldog születésnapot, Anna! 🎂',
    );
  });
});

describe('GET /users/me/birthday', () => {
  it('on the birthday: celebrate once a year, with the message filled in', async () => {
    const user = await createMember({ name: 'Kiss Anna', birthday: bornToday() });
    const first = await request(app).get('/users/me/birthday').set(asUser(user));
    expect(first.body.data).toEqual({
      celebrate: true,
      effect: 'confetti',
      message: 'Boldog születésnapot, Anna! 🎂',
    });
    // The same day (another device, a reload): not again.
    expect(
      (await request(app).get('/users/me/birthday').set(asUser(user))).body.data.celebrate,
    ).toBe(false);
    expect((await User.findById(user._id)).birthdayCelebratedYear).toBe(
      Number(budapestToday().slice(0, 4)),
    );
  });

  it('not on another day, without a birthday, when turned off, or logged out', async () => {
    const other = await createMember({ birthday: born('1990-01-01') });
    if (!isBirthday(other.birthday)) {
      expect(
        (await request(app).get('/users/me/birthday').set(asUser(other))).body.data.celebrate,
      ).toBe(false);
    }
    const none = await createMember();
    expect(
      (await request(app).get('/users/me/birthday').set(asUser(none))).body.data.celebrate,
    ).toBe(false);

    const settings = await getClubSettings();
    settings.birthday = { enabled: false, effect: 'confetti', message: 'x' };
    await settings.save();
    const today = await createMember({ birthday: bornToday() });
    expect(
      (await request(app).get('/users/me/birthday').set(asUser(today))).body.data.celebrate,
    ).toBe(false);
    // Turned off, nothing was used up: it still comes once turned back on.
    settings.birthday.enabled = true;
    await settings.save();
    expect(
      (await request(app).get('/users/me/birthday').set(asUser(today))).body.data.celebrate,
    ).toBe(true);

    expect((await request(app).get('/users/me/birthday')).status).toBe(401);
  });
});

describe('Klub → Beállítások: Születésnap', () => {
  it('admins set it; each change goes to the history', async () => {
    const admin = await createAdmin({ name: 'Admin Anna' });
    expect((await request(app).get('/settings/birthday').set(asUser(admin))).body.data).toEqual({
      enabled: true,
      effect: 'confetti',
      message: 'Boldog születésnapot, {név}! 🎂',
    });
    const put = await request(app)
      .put('/settings/birthday')
      .set(asUser(admin))
      .send({ enabled: true, effect: 'fireworks', message: 'Isten éltessen, {név}!' });
    expect(put.status).toBe(200);
    expect((await getClubSettings()).history.at(-1)).toMatchObject({
      byName: 'Admin Anna',
      change: 'Születésnap: effekt: Konfetti eső → Tűzijáték; üzenet: „Isten éltessen, {név}!”',
    });

    const user = await createMember({ name: 'Kovács Béla', birthday: bornToday(1985) });
    expect((await request(app).get('/users/me/birthday').set(asUser(user))).body.data).toEqual({
      celebrate: true,
      effect: 'fireworks',
      message: 'Isten éltessen, Béla!',
    });
  });

  it('checks the effect and the message; admins only', async () => {
    const admin = await createAdmin();
    const put = (body, user = admin) =>
      request(app).put('/settings/birthday').set(asUser(user)).send(body);
    expect((await put({ enabled: true, effect: 'robbanás', message: 'x' })).status).toBe(400);
    expect((await put({ enabled: true, effect: 'stars', message: '  ' })).status).toBe(400);
    expect((await put({ enabled: true, effect: 'stars', message: 'x'.repeat(201) })).status).toBe(
      400,
    );
    expect(
      (await put({ enabled: true, effect: 'stars', message: 'x' }, await createMember())).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get('/settings/birthday')
          .set(asUser(await createMember()))
      ).status,
    ).toBe(403);
  });
});
