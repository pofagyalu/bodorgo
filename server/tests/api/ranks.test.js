import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember, createReservation, createTour } from '../helpers/factories.js';
import User from '../../src/models/userModel.js';
import { getClubSettings } from '../../src/utils/clubSettings.js';
import sendResendEmail from '../../src/utils/resendEmail.js';
import { fillRankMessage, rankFor } from '../../src/utils/ranks.js';

// Rangok ünneplése (see utils/ranks.js): the first login after reaching a
// new rank. "Now" is set after the celebrations began (only Date is faked).
const BEFORE_START = new Date('2025-06-01T08:00:00Z');
const AFTER_START = new Date('2026-10-05T08:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

// Puts the user on `count` tours that started at `startDate`.
async function attend(user, count, startDate) {
  for (let i = 0; i < count; i++) {
    await createReservation(await createTour({ startDate }), [user]);
  }
}

const check = async (user) =>
  (await request(app).get('/users/me/rank').set(asUser(user))).body.data;

describe('rank helpers', () => {
  it('knows the ranks and fills in the message', () => {
    expect(rankFor(9)).toBeNull();
    expect(rankFor(10).name).toBe('Bronz');
    expect(rankFor(29).name).toBe('Ezüst');
    expect(rankFor(55).name).toBe('Gyémánt');
    const user = { name: 'Kovács Csaba', firstName: 'Csabi' };
    expect(fillRankMessage('{név}: {szám} ({rang})', user, 10, rankFor(10))).toBe(
      'Csabi: 10 (Bronz)',
    );
    expect(fillRankMessage('{név}: {szám} ({rang})', user, 11, rankFor(11))).toBe(
      'Csabi: 10+ (Bronz)',
    );
  });
});

describe('GET /users/me/rank', () => {
  it('a newly reached rank: celebrated once, and the admins are e-mailed', async () => {
    const admin = await createAdmin();
    const user = await createMember({ name: 'Kovács Csaba', firstName: 'Csabi' });
    await attend(user, 9, BEFORE_START);
    await attend(user, 1, AFTER_START);

    const first = await check(user);
    expect(first).toEqual({
      celebrate: true,
      effect: 'fireworks',
      message: 'Kedves Csabi! Túléltél 10 bódorgót! Ez egy remek teljesítmény, csak így tovább! 🏅',
    });
    await vi.waitFor(() => expect(sendResendEmail).toHaveBeenCalled());
    const [email] = vi.mocked(sendResendEmail).mock.calls.at(-1);
    expect(email.to).toEqual([admin.email]);
    expect(email.subject).toBe('Kovács Csaba elérte a Bronz bódorgó rangot');

    expect((await check(user)).celebrate).toBe(false);
    expect((await User.findById(user._id)).rankCelebrated).toBe(10);
  });

  it('logging in late: "10+"', async () => {
    const user = await createMember({ name: 'Nagy Péter' });
    await attend(user, 8, BEFORE_START);
    await attend(user, 4, AFTER_START);
    expect((await check(user)).message).toContain('Túléltél 10+ bódorgót');
  });

  it('a rank already had when the celebrations began counts as celebrated', async () => {
    const user = await createMember();
    await attend(user, 12, BEFORE_START);
    await attend(user, 1, AFTER_START); // 13: still Bronz
    expect((await check(user)).celebrate).toBe(false);
    expect((await User.findById(user._id)).rankCelebrated).toBe(10);
    expect(sendResendEmail).not.toHaveBeenCalled();

    await attend(user, 7, AFTER_START); // 20: Ezüst
    const res = await check(user);
    expect(res.celebrate).toBe(true);
    expect(res.message).toContain('Túléltél 20 bódorgót');
  });

  it('turned off: no celebration, but the rank is marked and the admins e-mailed', async () => {
    await createAdmin();
    const settings = await getClubSettings();
    settings.rankCelebration.enabled = false;
    await settings.save();
    const user = await createMember();
    await attend(user, 10, AFTER_START);

    expect((await check(user)).celebrate).toBe(false);
    expect((await User.findById(user._id)).rankCelebrated).toBe(10);
    await vi.waitFor(() => expect(sendResendEmail).toHaveBeenCalled());
  });

  it('nothing below 10 tours', async () => {
    const user = await createMember();
    await attend(user, 3, AFTER_START);
    expect((await check(user)).celebrate).toBe(false);
  });
});

describe('Klub → Beállítások: Rangok ünneplése', () => {
  it('admins set the effect and message; logged in the history', async () => {
    const member = await createMember();
    expect((await request(app).get('/settings/rank').set(asUser(member))).status).toBe(403);

    const admin = await createAdmin({ name: 'Admin Anna' });
    const got = await request(app).get('/settings/rank').set(asUser(admin));
    expect(got.body.data).toMatchObject({ enabled: true, effect: 'fireworks' });

    const put = await request(app)
      .put('/settings/rank')
      .set(asUser(admin))
      .send({ enabled: true, effect: 'stars', message: 'Szép volt, {név}! {szám} tábor!' });
    expect(put.status).toBe(200);
    const { history, rankCelebration } = await getClubSettings();
    expect(rankCelebration.effect).toBe('stars');
    expect(history.at(-1).change).toContain('Rangok ünneplése');

    const bad = await request(app)
      .put('/settings/rank')
      .set(asUser(admin))
      .send({ enabled: true, effect: 'nope', message: 'x' });
    expect(bad.status).toBe(400);
  });
});
