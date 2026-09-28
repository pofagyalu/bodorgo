import fs from 'fs';
import path from 'path';
import request from 'supertest';
import Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import {
  createAdmin,
  createGuest,
  createMember,
  createReservation,
  createTour,
} from '../helpers/factories.js';
import Payment from '../../src/models/paymentModel.js';
import Reservation from '../../src/models/reservationModel.js';
import Transaction from '../../src/models/transactionModel.js';
import User from '../../src/models/userModel.js';
import sendResendEmail from '../../src/utils/resendEmail.js';
import { getClubSettings } from '../../src/utils/clubSettings.js';
import { createCheckoutSession, retrieveCheckoutSession } from '../../src/utils/stripe.js';
import {
  createBarionPayment,
  getBarionPaymentState,
  createBarionWithdrawal,
} from '../../src/utils/barion.js';

// A tour with pricing and one unpaid member on it (+ an admin to receive
// "everyone paid" emails).
async function pricedTour() {
  const tour = await createTour({
    duration: 3,
    accommodationPricePerNight: 10000,
    advancePaymentPercentage: 30,
  });
  const member = await createMember({ lastLoginAt: new Date() });
  const reservation = await createReservation(tour, [member]);
  const admin = await createAdmin();
  return { tour, member, reservation, attendeeId: String(reservation.attendees[0]._id), admin };
}

const start = (user, body) => request(app).post('/payments/start').set(asUser(user)).send(body);

describe('paying a tour advance', () => {
  it('starts a Stripe payment for my own unpaid advance', async () => {
    const { tour, member, attendeeId } = await pricedTour();
    const res = await start(member, { tourId: tour._id, attendeeIds: [attendeeId] });
    expect(res.status).toBe(200);
    expect(res.body.data.gatewayUrl).toBe('https://stripe.test/checkout');
    const payment = await Payment.findById(res.body.data.paymentId);
    expect(payment).toMatchObject({
      status: 'Started',
      method: 'stripe',
      amount: 6000,
      providerPaymentId: 'cs_test',
    });
    expect(createCheckoutSession).toHaveBeenCalledOnce();
  });

  it('adds the Barion fee when paying with Barion', async () => {
    const { tour, member, attendeeId } = await pricedTour();
    const res = await start(member, {
      tourId: tour._id,
      attendeeIds: [attendeeId],
      method: 'barion',
    });
    expect(res.status).toBe(200);
    const payment = await Payment.findById(res.body.data.paymentId);
    expect(payment.amount).toBeGreaterThan(6000);
    expect(createBarionPayment).toHaveBeenCalledOnce();
  });

  it('refuses paying for someone outside my family, or with nothing owed', async () => {
    const { tour, attendeeId } = await pricedTour();
    const stranger = await createGuest();
    expect((await start(stranger, { tourId: tour._id, attendeeIds: [attendeeId] })).status).toBe(
      400,
    );
    expect((await start(stranger, { tourId: tour._id, attendeeIds: [] })).status).toBe(400);
    expect(
      (await start(stranger, { tourId: '000000000000000000000000', attendeeIds: ['x'] })).status,
    ).toBe(404);
  });

  it('marks the payment failed when the gateway is down', async () => {
    const { tour, member, attendeeId } = await pricedTour();
    vi.mocked(createCheckoutSession).mockRejectedValueOnce(new Error('down'));
    const res = await start(member, { tourId: tour._id, attendeeIds: [attendeeId] });
    expect(res.status).toBe(502);
    expect((await Payment.findOne()).status).toBe('Failed');
  });
});

describe('completing a payment', () => {
  async function startedPayment(method = 'stripe') {
    const setup = await pricedTour();
    const res = await start(setup.member, {
      tourId: setup.tour._id,
      attendeeIds: [setup.attendeeId],
      method,
    });
    return { ...setup, paymentId: res.body.data.paymentId };
  }

  it('Stripe: checking the status after a paid checkout marks everyone paid, emails a receipt', async () => {
    const { member, reservation, paymentId } = await startedPayment();
    vi.mocked(retrieveCheckoutSession).mockResolvedValueOnce({ payment_status: 'paid' });
    const res = await request(app).get(`/payments/${paymentId}/status`).set(asUser(member));
    expect(res.body.data.status).toBe('Succeeded');
    expect((await Reservation.findById(reservation._id)).attendees[0].paid).toBe(true);
    const payment = await Payment.findById(paymentId);
    expect(payment.receiptFilename).toBeTruthy();
    expect(fs.existsSync(path.join(process.env.RECEIPTS_DIR, payment.receiptFilename))).toBe(true);
    // Receipt to the payer + "everyone paid" to the admin.
    expect(vi.mocked(sendResendEmail).mock.calls.map(([e]) => e.subject)).toEqual([
      expect.stringContaining('Előleg befizetve'),
      expect.stringContaining('Mindenki befizette'),
    ]);

    // ...and the payer can download that receipt.
    const receipt = await request(app).get(`/payments/${paymentId}/receipt`).set(asUser(member));
    expect(receipt.status).toBe(200);
    expect(receipt.headers['content-type']).toContain('pdf');
  });

  it('Stripe: an expired checkout is recorded as expired', async () => {
    const { member, paymentId } = await startedPayment();
    vi.mocked(retrieveCheckoutSession).mockResolvedValueOnce({
      payment_status: 'unpaid',
      status: 'expired',
    });
    const res = await request(app).get(`/payments/${paymentId}/status`).set(asUser(member));
    expect(res.body.data.status).toBe('Expired');
  });

  it('Stripe webhook: only a correctly signed event counts', async () => {
    const { reservation, paymentId } = await startedPayment();
    const payload = JSON.stringify({
      id: 'evt_test',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test', payment_status: 'paid' } },
    });
    const bad = await request(app)
      .post('/payments/stripe/webhook')
      .set('stripe-signature', 'nonsense')
      .set('content-type', 'application/json')
      .send(payload);
    expect(bad.status).toBe(400);

    const header = new Stripe('sk_test_dummy').webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_WEBHOOK_SECRET,
    });
    const ok = await request(app)
      .post('/payments/stripe/webhook')
      .set('stripe-signature', header)
      .set('content-type', 'application/json')
      .send(payload);
    expect(ok.status).toBe(200);
    expect((await Payment.findById(paymentId)).status).toBe('Succeeded');
    expect((await Reservation.findById(reservation._id)).attendees[0].paid).toBe(true);
  });

  it('Barion: the callback checks the state and settles or expires the payment', async () => {
    const { paymentId } = await startedPayment('barion');
    expect((await request(app).get('/payments/barion/callback')).status).toBe(400);

    vi.mocked(getBarionPaymentState).mockResolvedValueOnce({ Status: 'Canceled' });
    await request(app).get('/payments/barion/callback?paymentId=barion-test');
    expect((await Payment.findById(paymentId)).status).toBe('Canceled');

    const second = await startedPayment('barion');
    await Payment.updateOne({ _id: paymentId }, { providerPaymentId: 'old' });
    vi.mocked(getBarionPaymentState).mockResolvedValueOnce({ Status: 'Succeeded' });
    await request(app).get('/payments/barion/callback?PaymentId=barion-test');
    expect((await Payment.findById(second.paymentId)).status).toBe('Succeeded');
  });

  it('Barion: the status check also settles, expires, and survives a gateway error in the callback', async () => {
    const { member, paymentId } = await startedPayment('barion');
    vi.mocked(getBarionPaymentState).mockRejectedValueOnce(new Error('down'));
    expect((await request(app).get('/payments/barion/callback?paymentId=barion-test')).status).toBe(
      200,
    );
    vi.mocked(getBarionPaymentState).mockResolvedValueOnce({ Status: 'Expired' });
    const res = await request(app).get(`/payments/${paymentId}/status`).set(asUser(member));
    expect(res.body.data.status).toBe('Expired');
  });

  it('only the payer may see the status; receipts for the payer or an admin', async () => {
    const { paymentId, admin } = await startedPayment();
    const other = await createMember();
    expect(
      (await request(app).get(`/payments/${paymentId}/status`).set(asUser(other))).status,
    ).toBe(403);
    expect(
      (await request(app).get(`/payments/${paymentId}/receipt`).set(asUser(other))).status,
    ).toBe(403);
    expect(
      (await request(app).get(`/payments/${paymentId}/receipt`).set(asUser(admin))).status,
    ).toBe(404); // no receipt yet
    expect(
      (await request(app).get('/payments/000000000000000000000000/status').set(asUser(other)))
        .status,
    ).toBe(404);
    expect(
      (await request(app).get('/payments/000000000000000000000000/receipt').set(asUser(other)))
        .status,
    ).toBe(404);
  });
});

describe('cash payments (admin)', () => {
  it('records a cash advance, and can undo it', async () => {
    const { tour, reservation, attendeeId, admin } = await pricedTour();
    const res = await request(app)
      .post('/payments/cash')
      .set(asUser(admin))
      .send({ tourId: tour._id, attendeeIds: [attendeeId] });
    expect(res.status).toBe(201);
    expect((await Reservation.findById(reservation._id)).attendees[0].paid).toBe(true);
    const undo = await request(app)
      .delete(`/payments/${res.body.data.payment._id}`)
      .set(asUser(admin));
    expect(undo.status).toBe(204);
    expect((await Reservation.findById(reservation._id)).attendees[0].paid).toBe(false);
  });

  it('refuses bad input, and undoing a non-cash payment', async () => {
    const { tour, member, attendeeId, admin } = await pricedTour();
    expect((await request(app).post('/payments/cash').set(asUser(admin)).send({})).status).toBe(
      400,
    );
    expect((await request(app).post('/payments/cash').set(asUser(member)).send({})).status).toBe(
      403,
    );
    const online = await start(member, { tourId: tour._id, attendeeIds: [attendeeId] });
    expect(
      (await request(app).delete(`/payments/${online.body.data.paymentId}`).set(asUser(admin)))
        .status,
    ).toBe(400);
    expect(
      (await request(app).delete('/payments/000000000000000000000000').set(asUser(admin))).status,
    ).toBe(404);
  });
});

describe('membership dues', () => {
  const thisYear = new Date().getFullYear();

  it('starts a payment for my unpaid years only, then records them as income', async () => {
    const member = await createMember({ memberSince: thisYear - 1, lastLoginAt: new Date() });
    await createAdmin();
    await Transaction.create({
      date: new Date(),
      name: 'x',
      type: 'income',
      category: 'Tagdíj',
      amount: 1000,
      user: member._id,
      membershipYear: thisYear - 1,
      createdBy: member._id,
    });
    const res = await request(app)
      .post('/payments/membership/start')
      .set(asUser(member))
      .send({
        items: [
          { userId: member._id, year: thisYear - 1 },
          { userId: member._id, year: thisYear },
        ],
      });
    expect(res.status).toBe(200);
    const payment = await Payment.findById(res.body.data.paymentId);
    expect(payment.members.map((m) => m.membershipYear)).toEqual([thisYear]);

    vi.mocked(retrieveCheckoutSession).mockResolvedValueOnce({ payment_status: 'paid' });
    await request(app).get(`/payments/${payment._id}/status`).set(asUser(member));
    const income = await Transaction.find({ user: member._id, membershipYear: thisYear });
    expect(income).toHaveLength(1);
  });

  it('refuses years already paid, outside membership, or other families', async () => {
    const member = await createMember({ memberSince: thisYear });
    const stranger = await createMember();
    const send = (items) =>
      request(app).post('/payments/membership/start').set(asUser(member)).send({ items });
    expect((await send([])).status).toBe(400);
    expect((await send([{ userId: member._id, year: thisYear - 1 }])).status).toBe(400);
    expect((await send([{ userId: stranger._id, year: thisYear }])).status).toBe(400);
  });

  it('marks the payment failed when the gateway is down', async () => {
    const member = await createMember();
    vi.mocked(createBarionPayment).mockRejectedValueOnce(new Error('down'));
    const res = await request(app)
      .post('/payments/membership/start')
      .set(asUser(member))
      .send({ method: 'barion', items: [{ userId: member._id, year: thisYear }] });
    expect(res.status).toBe(502);
  });
});

describe('withdrawals (admin)', () => {
  // The tour wallet's bank account is set on Beállítások (its key is in
  // the test .env); the membership one isn't set up.
  beforeEach(async () => {
    const settings = await getClubSettings();
    settings.set('barion.tour', {
      payeeEmail: 'tour@test.local',
      withdrawName: 'Teszt Klub',
      withdrawIban: 'HU42117730161111101800000000',
    });
    await settings.save();
  });

  it('reports which wallets are configured', async () => {
    const admin = await createAdmin();
    expect(
      (await request(app).get('/payments/withdraw/tourAdvance').set(asUser(admin))).body.data
        .configured,
    ).toBe(true);
    expect(
      (await request(app).get('/payments/withdraw/membershipFee').set(asUser(admin))).body.data
        .configured,
    ).toBe(false);
  });

  it('withdraws with the Barion fee (0.1%, at least 70 Ft)', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .post('/payments/withdraw')
      .set(asUser(admin))
      .send({ purpose: 'tourAdvance', amount: 10000 });
    expect(res.body.data).toEqual({ fee: 70, net: 9930 });
    expect(createBarionWithdrawal).toHaveBeenCalledOnce();
  });

  it('refuses an unconfigured wallet, a bad amount, and reports a gateway error', async () => {
    const admin = await createAdmin();
    const w = (body) => request(app).post('/payments/withdraw').set(asUser(admin)).send(body);
    expect((await w({ purpose: 'membershipFee', amount: 100 })).status).toBe(400);
    expect((await w({ purpose: 'tourAdvance', amount: -5 })).status).toBe(400);
    vi.mocked(createBarionWithdrawal).mockRejectedValueOnce(new Error('down'));
    expect((await w({ purpose: 'tourAdvance', amount: 100000 })).status).toBe(502);
  });
});

describe('when nobody has an email', () => {
  it('a payment still succeeds without receipt emails', async () => {
    const { tour, member, attendeeId } = await pricedTour();
    await User.updateOne({ _id: member._id }, { $unset: { email: 1 } });
    const res = await start(member, { tourId: tour._id, attendeeIds: [attendeeId] });
    vi.mocked(retrieveCheckoutSession).mockResolvedValueOnce({ payment_status: 'paid' });
    const status = await request(app)
      .get(`/payments/${res.body.data.paymentId}/status`)
      .set(asUser(member));
    expect(status.body.data.status).toBe('Succeeded');
  });
});
