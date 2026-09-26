import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createGuest, createMember } from '../helpers/factories.js';
import Transaction from '../../src/models/transactionModel.js';
import Payment from '../../src/models/paymentModel.js';
import { feeForYear } from '../../src/utils/clubSettings.js';

const url = '/settings/membership-fees';
const thisYear = new Date().getFullYear();

describe('Klub → Beállítások: membership fee by year', () => {
  it('starts at 1000 Ft from 2019; members see it, only admins see history', async () => {
    const member = await createMember();
    const res = await request(app).get(url).set(asUser(member));
    expect(res.status).toBe(200);
    expect(res.body.data.fees).toEqual([{ fromYear: 2019, amount: 1000 }]);
    expect(res.body.data.history).toBeUndefined();

    const admin = await request(app).get(url).set(asUser(await createAdmin()));
    expect(admin.body.data).toMatchObject({ paidYears: [], history: [] });
    expect((await request(app).get(url).set(asUser(await createGuest()))).status).toBe(403);
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
      .send({ items: [{ userId: member._id, year: thisYear - 1 }, { userId: member._id, year: thisYear }] });
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
      .send({ fees: [{ fromYear: 2019, amount: 1000 }, { fromYear: 2023, amount: 2000 }] });
    expect(raiseFrom2023.status).toBe(400);
    expect(raiseFrom2023.body.message).toContain('2024');

    // From 2025 on is fine - nobody paid those years yet.
    const raiseFrom2025 = await request(app)
      .put(url)
      .set(asUser(admin))
      .send({ fees: [{ fromYear: 2019, amount: 1000 }, { fromYear: 2025, amount: 2000 }] });
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
      (await put([{ fromYear: 2019, amount: 1000 }, { fromYear: 2019, amount: 2000 }])).status,
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
