import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createGuest, createMember } from '../helpers/factories.js';
import Transaction from '../../src/models/transactionModel.js';
import ClubSettings from '../../src/models/clubSettingsModel.js';
import sendResendEmail from '../../src/utils/resendEmail.js';
import {
  budapestDate,
  checkMembershipReminders,
  dueRound,
  notifyAdminsIfAllMembersPaid,
  reminderDates,
  unpaidMembers,
} from '../../src/utils/membershipReminders.js';

// "Tagdíj emlékeztető" (Klub → Beállítások): unpaid members get an e-mail on
// each round, the admins a summary.
const url = '/settings/membership-reminder';
const year = new Date().getFullYear();

const payDues = (user, admin, membershipYear = year) =>
  Transaction.create({
    date: new Date(),
    name: 'Tagdíj',
    type: 'income',
    category: 'Tagdíj',
    amount: 1000,
    user: user._id,
    membershipYear,
    createdBy: admin._id,
  });

const recipients = () => vi.mocked(sendResendEmail).mock.calls.map((c) => c[0].to);

describe('reminder rounds', () => {
  it('quarterly from 1 March: 1 March, 1 June, 1 September, 1 December', () => {
    expect(reminderDates({ startMonth: 3, startDay: 1, frequency: 'quarterly' }, 2027)).toEqual([
      '2027-03-01',
      '2027-06-01',
      '2027-09-01',
      '2027-12-01',
    ]);
  });

  it('monthly: every month from the start to December', () => {
    const dates = reminderDates({ startMonth: 10, startDay: 15, frequency: 'monthly' }, 2027);
    expect(dates).toEqual(['2027-10-15', '2027-11-15', '2027-12-15']);
  });

  it('a round is due once it has come and until it has been sent', () => {
    const r = { startMonth: 3, startDay: 1, frequency: 'quarterly' };
    expect(dueRound(r, '2027-02-28')).toBeNull();
    expect(dueRound(r, '2027-03-01')).toBe('2027-03-01');
    expect(dueRound({ ...r, lastRoundSent: '2027-03-01' }, '2027-05-31')).toBeNull();
    // A server that was down on the day sends it a day late.
    expect(dueRound({ ...r, lastRoundSent: '2027-03-01' }, '2027-06-02')).toBe('2027-06-01');
    // Last year's rounds don't count.
    expect(dueRound({ ...r, lastRoundSent: '2026-12-01' }, '2027-01-10')).toBeNull();
  });
});

describe('who gets one', () => {
  it('only club members who logged in, have not paid this year, and were members', async () => {
    const admin = await createAdmin({ lastLoginAt: new Date() });
    const unpaid = await createMember({ lastLoginAt: new Date() });
    const paid = await createMember({ lastLoginAt: new Date() });
    await payDues(paid, admin);
    await createMember(); // never logged in
    await createMember({ lastLoginAt: new Date(), retired: true });
    await createMember({ lastLoginAt: new Date(), memberSince: year + 1 });
    await createGuest({ lastLoginAt: new Date() });
    // Paid for last year only - still owes this year.
    const lastYearOnly = await createMember({ lastLoginAt: new Date() });
    await payDues(lastYearOnly, admin, year - 1);

    const names = (await unpaidMembers(year)).map((m) => m.name).sort();
    expect(names).toEqual([admin.name, unpaid.name, lastYearOnly.name].sort());
  });
});

describe('Tagdíj emlékeztető settings', () => {
  it('admins only', async () => {
    const member = await createMember();
    expect((await request(app).get(url).set(asUser(member))).status).toBe(403);
    expect((await request(app).put(url).set(asUser(member)).send({})).status).toBe(403);
    expect((await request(app).post(`${url}/test`).set(asUser(member))).status).toBe(403);
  });

  it('defaults to off, 1 March, quarterly - and lists who would get one now', async () => {
    const admin = await createAdmin({ lastLoginAt: new Date() });
    const unpaid = await createMember({ lastLoginAt: new Date() });
    const res = await request(app).get(url).set(asUser(admin));
    expect(res.body.data.reminder).toMatchObject({
      enabled: false,
      startMonth: 3,
      startDay: 1,
      frequency: 'quarterly',
      nextRound: null,
    });
    expect(res.body.data.reminder.dates).toHaveLength(4);
    expect(res.body.data.recipients).toEqual(expect.arrayContaining([admin.name, unpaid.name]));
  });

  it('validates, and switching on does not send the rounds already past', async () => {
    const admin = await createAdmin();
    const put = (body) => request(app).put(url).set(asUser(admin)).send(body);
    expect(
      (await put({ enabled: true, startMonth: 13, startDay: 1, frequency: 'monthly' })).status,
    ).toBe(400);
    expect(
      (await put({ enabled: true, startMonth: 1, startDay: 31, frequency: 'monthly' })).status,
    ).toBe(400);
    expect(
      (await put({ enabled: true, startMonth: 1, startDay: 1, frequency: 'weekly' })).status,
    ).toBe(400);

    const res = await put({ enabled: true, startMonth: 1, startDay: 1, frequency: 'monthly' });
    expect(res.status).toBe(200);
    // This month's round (1st) has already come: it counts as done.
    const today = budapestDate();
    expect(res.body.data.reminder.lastRoundSent).toBe(`${today.slice(0, 7)}-01`);
    expect(res.body.data.reminder.nextRound > today).toBe(true);
    const settings = await ClubSettings.findOne({ key: 'club' });
    expect(settings.history.at(-1).change).toContain('Tagdíj emlékeztető');
  });

  it('sends a test reminder to the admin themselves', async () => {
    const admin = await createAdmin();
    const res = await request(app).post(`${url}/test`).set(asUser(admin));
    expect(res.status).toBe(200);
    expect(recipients()).toEqual([admin.email]);
    expect(vi.mocked(sendResendEmail).mock.calls[0][0].subject).toContain('Tagdíj emlékeztető');
  });
});

describe('the regular check', () => {
  it('sends a due round once: each unpaid member, then a summary to the admins', async () => {
    const admin = await createAdmin({ lastLoginAt: new Date() });
    const unpaid = await createMember({ lastLoginAt: new Date() });
    const paid = await createMember({ lastLoginAt: new Date() });
    await payDues(paid, admin);
    await payDues(admin, admin);
    // A round came yesterday and hasn't gone out yet.
    await ClubSettings.findOneAndUpdate(
      { key: 'club' },
      {
        membershipReminder: {
          enabled: true,
          startMonth: 1,
          startDay: 1,
          frequency: 'monthly',
          lastRoundSent: `${year - 1}-12-01`,
        },
      },
      { upsert: true },
    );

    const noon = new Date(`${budapestDate()}T10:00:00Z`); // noon in Budapest
    const result = await checkMembershipReminders(noon);
    expect(result.sent).toEqual([unpaid.name]);
    expect(recipients()).toEqual([unpaid.email, admin.email]);
    const summary = vi.mocked(sendResendEmail).mock.calls[1][0];
    expect(summary.subject).toContain('1 tag');
    expect(summary.text).toContain(unpaid.name);

    // Once: the next check sends nothing.
    expect(await checkMembershipReminders(noon)).toBeNull();
    expect(recipients()).toHaveLength(2);
  });

  it('never at night, and not when switched off', async () => {
    await createMember({ lastLoginAt: new Date() });
    await ClubSettings.findOneAndUpdate(
      { key: 'club' },
      { membershipReminder: { enabled: true, startMonth: 1, startDay: 1, frequency: 'monthly' } },
      { upsert: true },
    );
    const night = new Date(`${budapestDate()}T01:00:00Z`); // 2-3 a.m. in Budapest
    expect(await checkMembershipReminders(night)).toBeNull();

    await ClubSettings.updateOne({ key: 'club' }, { 'membershipReminder.enabled': false });
    const noon = new Date(`${budapestDate()}T10:00:00Z`);
    expect(await checkMembershipReminders(noon)).toBeNull();
    expect(sendResendEmail).not.toHaveBeenCalled();
  });
});

describe('"Minden klubtag befizette a tagdíjat" to the admins', () => {
  it('once everyone has paid - suspended members do not count - and only once a year', async () => {
    const admin = await createAdmin();
    const member = await createMember();
    await createMember({ retired: true }); // suspended: never pays, must not block it
    await createMember({ memberSince: year + 1 }); // not a member yet this year
    await payDues(admin, admin);
    expect(await notifyAdminsIfAllMembersPaid(year)).toBe(false);
    expect(sendResendEmail).not.toHaveBeenCalled();

    await payDues(member, admin);
    expect(await notifyAdminsIfAllMembersPaid(year)).toBe(true);
    const mail = vi.mocked(sendResendEmail).mock.calls[0][0];
    expect(mail.to).toEqual([admin.email]);
    expect(mail.subject).toContain(`${year}. évi tagdíjat`);

    // A later payment or correction doesn't send it again.
    expect(await notifyAdminsIfAllMembersPaid(year)).toBe(false);
    expect(sendResendEmail).toHaveBeenCalledTimes(1);
  });
});

describe('cash dues (Klub → Felhasználók, admin)', () => {
  const cash = (admin, body) =>
    request(app).post('/payments/cash-membership').set(asUser(admin)).send(body);

  it('records a real cash payment and its Tagdíj income, linked', async () => {
    const admin = await createAdmin();
    const member = await createMember();
    const res = await cash(admin, { userId: member._id, year });
    expect(res.status).toBe(201);
    expect(res.body.data.payment).toMatchObject({
      purpose: 'membershipFee',
      method: 'cash',
      status: 'Succeeded',
      amount: 1000,
    });
    const tx = await Transaction.findOne({ user: member._id, membershipYear: year });
    expect(tx).toMatchObject({ category: 'Tagdíj', amount: 1000, paymentMethod: 'cash' });
    expect(String(tx.payment)).toBe(res.body.data.payment._id);
    // Now paid: no reminder for them.
    expect((await unpaidMembers(year)).map((m) => m.name)).not.toContain(member.name);
  });

  it('refuses a year already paid, before membership, or a non-member; admins only', async () => {
    const admin = await createAdmin();
    const member = await createMember({ memberSince: year });
    await cash(admin, { userId: member._id, year });
    expect((await cash(admin, { userId: member._id, year })).status).toBe(400);
    expect((await cash(admin, { userId: member._id, year: year - 1 })).status).toBe(400);
    const guest = await createGuest();
    expect((await cash(admin, { userId: guest._id, year })).status).toBe(404);
    expect((await cash(await createMember(), { userId: member._id, year })).status).toBe(403);
  });

  it('sends no e-mail itself, so a misclick undone right away leaves no trace', async () => {
    const admin = await createAdmin();
    await payDues(admin, admin);
    const member = await createMember();
    const res = await cash(admin, { userId: member._id, year });
    const undo = await request(app)
      .delete(`/payments/${res.body.data.payment._id}`)
      .set(asUser(admin));
    expect(undo.status).toBe(204);
    expect(await Transaction.exists({ user: member._id, membershipYear: year })).toBeNull();
    expect(sendResendEmail).not.toHaveBeenCalled();
  });

  it('a real last cash payment: the hourly check tells the admins everyone has paid', async () => {
    const admin = await createAdmin();
    await payDues(admin, admin);
    const member = await createMember();
    await cash(admin, { userId: member._id, year });
    expect(sendResendEmail).not.toHaveBeenCalled();

    // What server.js runs every hour.
    expect(await notifyAdminsIfAllMembersPaid()).toBe(true);
    expect(vi.mocked(sendResendEmail).mock.calls[0][0].subject).toContain('Minden klubtag');
  });
});
