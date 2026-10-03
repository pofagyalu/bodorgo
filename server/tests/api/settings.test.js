import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createGuest, createMember } from '../helpers/factories.js';
import Transaction from '../../src/models/transactionModel.js';
import Payment from '../../src/models/paymentModel.js';
import { feeForYear, getClubSettings } from '../../src/utils/clubSettings.js';
import sendResendEmail from '../../src/utils/resendEmail.js';
import { createBarionWithdrawal } from '../../src/utils/barion.js';

const url = '/settings/membership-fees';
const thisYear = new Date().getFullYear();

describe('Klub → Beállítások: membership fee by year', () => {
  it('starts at 1000 Ft from 2019; members see it, only admins see history', async () => {
    const member = await createMember();
    const res = await request(app).get(url).set(asUser(member));
    expect(res.status).toBe(200);
    expect(res.body.data.fees).toEqual([{ fromYear: 2019, amount: 1000 }]);
    expect(res.body.data.history).toBeUndefined();
    // The payment deadline: the first reminder's day (1 March by default).
    expect(res.body.data.paymentDeadline).toEqual({ month: 3, day: 1 });

    const admin = await request(app)
      .get(url)
      .set(asUser(await createAdmin()));
    expect(admin.body.data).toMatchObject({ paidYears: [], history: [] });
    expect(
      (
        await request(app)
          .get(url)
          .set(asUser(await createGuest()))
      ).status,
    ).toBe(403);
  });

  it('an admin raises it from a year on; older years keep their fee, the change is logged', async () => {
    const admin = await createAdmin({ name: 'Admin Anna' });
    const fees = [
      { fromYear: 2019, amount: 1000 },
      { fromYear: thisYear, amount: 1500 },
    ];
    const res = await request(app).put(url).set(asUser(admin)).send({ fees });
    expect(res.status).toBe(200);

    const back = await request(app).get(url).set(asUser(admin));
    expect(back.body.data.fees).toEqual(fees);
    expect(back.body.data.history[0]).toMatchObject({
      byName: 'Admin Anna',
      change: `Tagdíj: 2019-től 1000 Ft → 2019-től 1000 Ft, ${thisYear}-től 1500 Ft`,
    });

    // The new fee is what a member is charged for this year, the old one
    // for last year.
    const member = await createMember({ memberSince: thisYear - 1 });
    const pay = await request(app)
      .post('/payments/membership/start')
      .set(asUser(member))
      .send({
        items: [
          { userId: member._id, year: thisYear - 1 },
          { userId: member._id, year: thisYear },
        ],
      });
    const payment = await Payment.findById(pay.body.data.paymentId);
    expect(payment.members.map((m) => [m.membershipYear, m.amount])).toEqual([
      [thisYear - 1, 1000],
      [thisYear, 1500],
    ]);
  });

  it("won't change the fee of a year somebody already paid for", async () => {
    const admin = await createAdmin();
    await Transaction.create({
      date: new Date(),
      name: 'x',
      type: 'income',
      category: 'Tagdíj',
      amount: 1000,
      membershipYear: 2024,
      createdBy: admin._id,
    });
    expect((await request(app).get(url).set(asUser(admin))).body.data.paidYears).toEqual([2024]);

    const raiseFrom2023 = await request(app)
      .put(url)
      .set(asUser(admin))
      .send({
        fees: [
          { fromYear: 2019, amount: 1000 },
          { fromYear: 2023, amount: 2000 },
        ],
      });
    expect(raiseFrom2023.status).toBe(400);
    expect(raiseFrom2023.body.message).toContain('2024');

    // From 2025 on is fine - nobody paid those years yet.
    const raiseFrom2025 = await request(app)
      .put(url)
      .set(asUser(admin))
      .send({
        fees: [
          { fromYear: 2019, amount: 1000 },
          { fromYear: 2025, amount: 2000 },
        ],
      });
    expect(raiseFrom2025.status).toBe(200);
  });

  it('checks the table: whole numbers, no year twice, founding year covered, admins only', async () => {
    const admin = await createAdmin();
    const put = (fees, user = admin) => request(app).put(url).set(asUser(user)).send({ fees });
    expect((await put([])).status).toBe(400);
    expect((await put([{ fromYear: 2019, amount: 0 }])).status).toBe(400);
    expect((await put([{ fromYear: 2019, amount: 1000.5 }])).status).toBe(400);
    expect((await put([{ fromYear: 2018, amount: 1000 }])).status).toBe(400);
    expect((await put([{ fromYear: 2021, amount: 1000 }])).status).toBe(400); // 2019-2020 uncovered
    expect(
      (
        await put([
          { fromYear: 2019, amount: 1000 },
          { fromYear: 2019, amount: 2000 },
        ])
      ).status,
    ).toBe(400);
    expect((await put([{ fromYear: 2019, amount: 1000 }], await createMember())).status).toBe(403);
  });
});

describe('feeForYear', () => {
  it('picks the latest row that has started', () => {
    const fees = [
      { fromYear: 2027, amount: 1500 },
      { fromYear: 2019, amount: 1000 },
    ];
    expect(feeForYear(fees, 2019)).toBe(1000);
    expect(feeForYear(fees, 2026)).toBe(1000);
    expect(feeForYear(fees, 2027)).toBe(1500);
    expect(feeForYear(fees, 2030)).toBe(1500);
    expect(feeForYear(fees, 2018)).toBeNull();
  });
});

describe('Klub → Beállítások: Barion wallets', () => {
  const IBAN = 'HU42117730161111101800000000';
  const wallet = (overrides = {}) => ({
    payeeEmail: 'klub@barion.test',
    withdrawName: 'Bódorgó KLUB',
    withdrawIban: 'hu42 1177 3016 1111 1018 0000 0000',
    ...overrides,
  });

  it('an admin sets a wallet: its Barion e-mail and bank account', async () => {
    const admin = await createAdmin({ name: 'Admin Anna' });
    const put = await request(app)
      .put('/settings/barion/membership')
      .set(asUser(admin))
      .send(wallet());
    expect(put.status).toBe(200);
    const got = (await request(app).get('/settings/barion').set(asUser(admin))).body.data;
    expect(got.membership).toEqual({
      payeeEmail: 'klub@barion.test',
      withdrawName: 'Bódorgó KLUB',
      withdrawIban: 'HU42 1177 3016 1111 1018 0000 0000',
    });
    expect(got.tour).toEqual({ payeeEmail: '', withdrawName: '', withdrawIban: '' });
    // Stored clean: the IBAN without spaces.
    expect((await getClubSettings()).barion.membership.withdrawIban).toBe(IBAN);
    // Without its API key (a secret in .env) it can't be withdrawn from yet.
    expect(
      (await request(app).get('/payments/withdraw/membershipFee').set(asUser(admin))).body.data
        .configured,
    ).toBe(false);
  });

  it('every change goes to the history and to every admin by e-mail', async () => {
    const admin = await createAdmin({ name: 'Admin Anna' });
    await createAdmin({ name: 'Admin Béla' });
    await request(app).put('/settings/barion/tour').set(asUser(admin)).send(wallet());
    vi.mocked(sendResendEmail).mockClear();

    const res = await request(app)
      .put('/settings/barion/tour')
      .set(asUser(admin))
      .send(wallet({ withdrawName: 'Új Név' }));
    expect(res.status).toBe(200);

    const history = (await getClubSettings()).history.at(-1);
    expect(history).toMatchObject({ byName: 'Admin Anna' });
    expect(history.change).toBe('Barion (Előlegek): Számlatulajdonos: Bódorgó KLUB → Új Név');

    expect(sendResendEmail).toHaveBeenCalledOnce();
    const mail = vi.mocked(sendResendEmail).mock.calls[0][0];
    expect(mail.to).toHaveLength(2);
    expect(mail.subject).toContain('Előlegek');
    expect(mail.text).toContain('Bódorgó KLUB → Új Név');

    // Saving it unchanged: nothing to log, nobody to tell.
    vi.mocked(sendResendEmail).mockClear();
    await request(app)
      .put('/settings/barion/tour')
      .set(asUser(admin))
      .send(wallet({ withdrawName: 'Új Név' }));
    expect(sendResendEmail).not.toHaveBeenCalled();
  });

  it('a withdrawal goes to the account set here, with the key from .env', async () => {
    const admin = await createAdmin();
    await request(app).put('/settings/barion/tour').set(asUser(admin)).send(wallet());
    vi.mocked(createBarionWithdrawal).mockClear();
    await request(app)
      .post('/payments/withdraw')
      .set(asUser(admin))
      .send({ purpose: 'tourAdvance', amount: 1000 });
    expect(createBarionWithdrawal).toHaveBeenCalledWith({
      walletKey: 'wallet-test',
      amount: 1000,
      recipientName: 'Bódorgó KLUB',
      iban: IBAN,
    });
  });

  it('checks the IBAN (Hungarian, right check digits), the e-mail and the name; admins only', async () => {
    const admin = await createAdmin();
    const put = (body, user = admin, key = 'membership') =>
      request(app).put(`/settings/barion/${key}`).set(asUser(user)).send(body);
    expect((await put(wallet({ withdrawIban: 'HU43117730161111101800000000' }))).status).toBe(400);
    expect((await put(wallet({ withdrawIban: 'DE89370400440532013000' }))).status).toBe(400);
    expect((await put(wallet({ payeeEmail: 'nem-email' }))).status).toBe(400);
    expect((await put(wallet({ withdrawName: '  ' }))).status).toBe(400);
    expect((await put(wallet(), admin, 'mas')).status).toBe(404);
    expect((await put(wallet(), await createMember())).status).toBe(403);
    expect(
      (
        await request(app)
          .get('/settings/barion')
          .set(asUser(await createMember()))
      ).status,
    ).toBe(403);
  });
});

describe('Klub → Beállítások: Fizetési módok', () => {
  const put = (user, key, body) =>
    request(app).put(`/settings/payment-methods/${key}`).set(asUser(user)).send(body);

  it('Stripe is on and Barion off by default; anyone logged in sees them', async () => {
    const res = await request(app)
      .get('/settings/payment-methods')
      .set(asUser(await createGuest()));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      stripe: {
        enabled: true,
        feePercent: 1.5,
        feeFixed: 85,
        feeMin: 0,
        wallets: { membership: true, tour: true },
      },
      barion: {
        enabled: false,
        feePercent: 1.6,
        feeFixed: 0,
        feeMin: 0,
        wallets: { membership: true, tour: true },
      },
    });
  });

  it('an admin switches a method on and sets its fee - recorded in the history', async () => {
    const admin = await createAdmin();
    const body = { enabled: true, feePercent: 1.2, feeFixed: 0, feeMin: 50 };
    const res = await put(admin, 'barion', body);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(body);
    const settings = await getClubSettings();
    expect(settings.paymentMethods.barion.enabled).toBe(true);
    expect(settings.history.at(-1).change).toContain('Fizetési mód (Barion)');
    // Nothing changed - nothing recorded.
    await put(admin, 'barion', body);
    expect((await getClubSettings()).history).toHaveLength(1);
  });

  it('checks the numbers and the method; admins only', async () => {
    const admin = await createAdmin();
    const ok = { enabled: true, feePercent: 1.5, feeFixed: 85, feeMin: 0 };
    expect((await put(admin, 'stripe', { ...ok, feePercent: 25 })).status).toBe(400);
    expect((await put(admin, 'stripe', { ...ok, feeFixed: -1 })).status).toBe(400);
    expect((await put(admin, 'stripe', { ...ok, feeMin: 1.5 })).status).toBe(400);
    expect((await put(admin, 'paypal', ok)).status).toBe(404);
    expect((await put(await createMember(), 'stripe', ok)).status).toBe(403);
  });
});
