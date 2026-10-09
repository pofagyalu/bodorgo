import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as openidClient from 'openid-client';
import { app, asUser } from '../helpers/app.js';
import {
  createAdmin,
  createGuest,
  createMember,
  createReservation,
  createTour,
} from '../helpers/factories.js';
import AuditLog from '../../src/models/auditLogModel.js';
import Payment from '../../src/models/paymentModel.js';
import Reservation from '../../src/models/reservationModel.js';
import User from '../../src/models/userModel.js';
import { getClubSettings } from '../../src/utils/clubSettings.js';
import { createBarionWithdrawal } from '../../src/utils/barion.js';
import { safeReturnTo } from '../../src/controllers/authOidcController.js';

// A session lives for 90 days, so what moves money or rights asks who it is
// again: it only goes for someone who identified themselves at the provider
// in the last ten minutes (auth/freshLogin.js). What such an operation
// leaves in the Napló is in auditLog.test.js.

vi.mock('openid-client', () => ({
  discovery: vi.fn(async () => ({})),
  randomPKCECodeVerifier: () => 'verifier',
  calculatePKCECodeChallenge: async () => 'challenge',
  randomState: () => 'state',
  randomNonce: () => 'nonce',
  buildAuthorizationUrl: vi.fn(() => new URL('https://auth.test/authorize?client_id=x')),
}));

const IBAN = 'HU42117730161111101800000000';
const year = new Date().getFullYear();
// Someone who logged in long ago, and someone the provider said nothing about.
const LONG_AGO = { minutesAgo: 11 };
const NEVER = { minutesAgo: null };

const expectAsksAgain = (res) => {
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('fresh-login-required');
  expect(res.body.message).toContain('újra azonosítanod');
};

async function pricedTour() {
  const tour = await createTour({
    duration: 3,
    accommodationPricePerNight: 10000,
    advancePaymentPercentage: 30,
  });
  const member = await createMember();
  const reservation = await createReservation(tour, [member]);
  return { tour, reservation, attendeeId: String(reservation.attendees[0]._id) };
}

beforeEach(async () => {
  const settings = await getClubSettings();
  settings.set('barion.tour', {
    payeeEmail: 'tour@test.local',
    withdrawName: 'Teszt Klub',
    withdrawIban: IBAN,
  });
  await settings.save();
});

describe('who am I: how long sensitive operations stay open', () => {
  it('ten minutes from the real login at the provider - not from the app login', async () => {
    const admin = await createAdmin();
    const left = async (when) =>
      (await request(app).get('/auth/me').set(asUser(admin, when))).body.freshLoginSecondsLeft;
    expect(await left()).toBeGreaterThan(590);
    expect(await left({ minutesAgo: 9 })).toBeGreaterThan(0);
    expect(await left({ minutesAgo: 9 })).toBeLessThanOrEqual(60);
    expect(await left(LONG_AGO)).toBe(0);
    expect(await left(NEVER)).toBe(0);
  });
});

describe('asking the provider again', () => {
  it('?stepup=1 makes the provider ask unless they logged in there in the last five minutes', async () => {
    await request(app).get('/auth/login');
    expect(vi.mocked(openidClient.buildAuthorizationUrl).mock.calls[0][1].max_age).toBeUndefined();
    await request(app).get('/auth/login?stepup=1&returnTo=/klub/naplo');
    const asked = vi.mocked(openidClient.buildAuthorizationUrl).mock.calls[1][1];
    expect(asked.max_age).toBe(300);
    // Not prompt=login: Authentik obeys that only once in a session of its own.
    expect(asked.prompt).toBeUndefined();
  });

  it("comes back to a page of the client only - never to somebody else's address", () => {
    expect(safeReturnTo('/klub/beallitasok?lap=klub')).toBe('/klub/beallitasok?lap=klub');
    expect(safeReturnTo('/')).toBe('/');
    for (const bad of ['//evil.test', '/\\evil.test', 'https://evil.test', 'klub', '', undefined]) {
      expect(safeReturnTo(bad)).toBeNull();
    }
  });
});

describe('a role is changed only after identifying again', () => {
  it('the role manager, logged in long ago, is asked again - everything else still saves', async () => {
    const owner = await createAdmin({ canManageRoles: true });
    const guest = await createGuest();
    const patch = (when, body) =>
      request(app).patch(`/users/${guest._id}`).set(asUser(owner, when)).send(body);

    expectAsksAgain(await patch(LONG_AGO, { role: 'member' }));
    expectAsksAgain(await patch(NEVER, { role: 'member' }));
    expect((await User.findById(guest._id)).role).toBe('guest');
    // The edit form always sends the role: unchanged, it asks nothing.
    expect((await patch(LONG_AGO, { role: 'guest', name: 'Új Név' })).status).toBe(200);
    expect(await AuditLog.countDocuments()).toBe(0);

    expect((await patch(undefined, { role: 'member' })).status).toBe(200);
    expect((await User.findById(guest._id)).role).toBe('member');
  });

  it('adding someone with a role asks too; adding a guest does not', async () => {
    const owner = await createAdmin({ canManageRoles: true });
    const add = (when, body) => request(app).post('/users').set(asUser(owner, when)).send(body);
    expectAsksAgain(await add(LONG_AGO, { name: 'Tag Jelölt', role: 'member' }));
    expect(await User.countDocuments({ name: 'Tag Jelölt' })).toBe(0);
    expect((await add(LONG_AGO, { name: 'Vendég Jelölt' })).status).toBe(201);
    expect((await add(undefined, { name: 'Tag Jelölt', role: 'member' })).status).toBe(201);
  });
});

describe('cash payments are recorded only after identifying again', () => {
  it('an advance and its undo', async () => {
    const admin = await createAdmin();
    const { tour, reservation, attendeeId } = await pricedTour();
    const pay = (when) =>
      request(app)
        .post('/payments/cash')
        .set(asUser(admin, when))
        .send({ tourId: tour._id, attendeeIds: [attendeeId] });

    expectAsksAgain(await pay(LONG_AGO));
    expect(await Payment.countDocuments()).toBe(0);
    expect((await Reservation.findById(reservation._id)).attendees[0].paid).toBe(false);
    expect(await AuditLog.countDocuments()).toBe(0);

    const paid = await pay();
    expect(paid.status).toBe(201);
    const id = paid.body.data.payment._id;
    expectAsksAgain(await request(app).delete(`/payments/${id}`).set(asUser(admin, LONG_AGO)));
    expect(await Payment.countDocuments()).toBe(1);
    expect((await request(app).delete(`/payments/${id}`).set(asUser(admin))).status).toBe(204);
  });

  it("a member's dues", async () => {
    const admin = await createAdmin();
    const member = await createMember();
    const pay = (when) =>
      request(app)
        .post('/payments/cash-membership')
        .set(asUser(admin, when))
        .send({ userId: member._id, year });

    expectAsksAgain(await pay(LONG_AGO));
    expect(await Payment.countDocuments()).toBe(0);
    expect((await pay()).status).toBe(201);
  });
});

describe('a payout, and where it goes, only after identifying again', () => {
  it('Kiutalás a számlára - looking at it asks nothing', async () => {
    const admin = await createAdmin();
    const withdraw = (when) =>
      request(app)
        .post('/payments/withdraw')
        .set(asUser(admin, when))
        .send({ purpose: 'tourAdvance', amount: 10000 });

    expectAsksAgain(await withdraw(LONG_AGO));
    expect(createBarionWithdrawal).not.toHaveBeenCalled();
    expect(
      (await request(app).get('/payments/withdraw/tourAdvance').set(asUser(admin, LONG_AGO)))
        .status,
    ).toBe(200);

    expect((await withdraw()).status).toBe(200);
    expect(createBarionWithdrawal).toHaveBeenCalledOnce();
  });

  it("the wallet's bank account", async () => {
    const admin = await createAdmin();
    const save = (when) =>
      request(app)
        .put('/settings/barion/tour')
        .set(asUser(admin, when))
        .send({ payeeEmail: 'tour@test.local', withdrawName: 'Valaki Más', withdrawIban: IBAN });

    expectAsksAgain(await save(LONG_AGO));
    expect((await getClubSettings()).barion.tour.withdrawName).toBe('Teszt Klub');
    expect((await request(app).get('/settings/barion').set(asUser(admin, LONG_AGO))).status).toBe(
      200,
    );

    expect((await save()).status).toBe(200);
    expect((await getClubSettings()).barion.tour.withdrawName).toBe('Valaki Más');
  });
});

describe('what is not sensitive goes as before', () => {
  it('reading the Napló, and the settings that were left out on purpose', async () => {
    const owner = await createAdmin({ canManageRoles: true });
    const get = (url) => request(app).get(url).set(asUser(owner, LONG_AGO));
    expect((await get('/settings/audit-log')).status).toBe(200);
    // The OIDC provider's settings: needed exactly when logging in is broken.
    expect((await get('/settings/oidc')).status).toBe(200);
  });
});
