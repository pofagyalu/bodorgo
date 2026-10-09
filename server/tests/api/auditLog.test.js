import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import {
  createAdmin,
  createGuest,
  createMember,
  createReservation,
  createTour,
} from '../helpers/factories.js';
import AuditLog from '../../src/models/auditLogModel.js';
import sendResendEmail from '../../src/utils/resendEmail.js';
import { getClubSettings } from '../../src/utils/clubSettings.js';
import { createBarionWithdrawal } from '../../src/utils/barion.js';

// Napló: what moves money or rights leaves a line - who, what, when
// (utils/auditLog.js) -, read by the admins on Klub → Napló together with
// the changes of the club's settings.

const IBAN = 'HU42117730161111101800000000';
const year = new Date().getFullYear();

async function pricedTour() {
  const tour = await createTour({
    title: 'Sarud',
    duration: 3,
    accommodationPricePerNight: 10000,
    advancePaymentPercentage: 30,
  });
  const member = await createMember({ name: 'Fizető Tag' });
  const reservation = await createReservation(tour, [member]);
  return { tour, member, reservation, attendeeId: String(reservation.attendees[0]._id) };
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

describe('a role given or changed', () => {
  it('is in the Napló with old and new, and every admin gets an e-mail', async () => {
    const owner = await createAdmin({ canManageRoles: true, name: 'Gazda' });
    const other = await createAdmin();
    const guest = await createGuest({ name: 'Új Ember' });
    const patch = (body) => request(app).patch(`/users/${guest._id}`).set(asUser(owner)).send(body);

    // The edit form always sends the role: unchanged, it leaves no line.
    await patch({ role: 'guest', name: 'Új Ember' });
    expect(await AuditLog.countDocuments()).toBe(0);
    expect(sendResendEmail).not.toHaveBeenCalled();

    expect((await patch({ role: 'admin' })).status).toBe(200);
    const entry = await AuditLog.findOne();
    expect(entry).toMatchObject({
      action: 'role-change',
      actorName: 'Gazda',
      targetName: 'Új Ember',
      summary: 'Új Ember szerepköre: Vendég → Admin',
      details: { from: 'guest', to: 'admin' },
    });
    expect(String(entry.actor)).toBe(String(owner._id));
    const mail = vi.mocked(sendResendEmail).mock.calls[0][0];
    expect(mail.to.sort()).toEqual([owner.email, other.email, guest.email].sort());
    expect(mail.subject).toContain('Új Ember szerepköre: Vendég → Admin');
    expect(mail.text).toContain('Gazda');
  });

  it('a refused change leaves no line', async () => {
    const admin = await createAdmin(); // not the role manager
    const guest = await createGuest();
    const res = await request(app)
      .patch(`/users/${guest._id}`)
      .set(asUser(admin))
      .send({ role: 'member' });
    expect(res.status).toBe(403);
    expect(await AuditLog.countDocuments()).toBe(0);
  });

  it('adding someone with a role is a line too; adding a guest is not', async () => {
    const owner = await createAdmin({ canManageRoles: true });
    const add = (body) => request(app).post('/users').set(asUser(owner)).send(body);
    expect((await add({ name: 'Vendég Jelölt' })).status).toBe(201);
    expect(await AuditLog.countDocuments()).toBe(0);

    expect((await add({ name: 'Tag Jelölt', role: 'member' })).status).toBe(201);
    expect((await AuditLog.findOne()).summary).toBe(
      'Tag Jelölt új felhasználó szerepköre: Klubtag',
    );
  });
});

describe('cash payments', () => {
  it('an advance and its undo are both in the Napló - with no e-mail of their own', async () => {
    const admin = await createAdmin({ name: 'Pénztáros' });
    const { tour, attendeeId } = await pricedTour();
    const paid = await request(app)
      .post('/payments/cash')
      .set(asUser(admin))
      .send({ tourId: tour._id, attendeeIds: [attendeeId] });
    expect(paid.status).toBe(201);

    const other = await createAdmin({ name: 'Másik Admin' });
    const undo = await request(app)
      .delete(`/payments/${paid.body.data.payment._id}`)
      .set(asUser(other));
    expect(undo.status).toBe(204);

    const [recorded, undone] = await AuditLog.find().sort({ _id: 1 });
    expect(recorded).toMatchObject({
      action: 'cash-advance',
      actorName: 'Pénztáros',
      summary: 'Készpénzes előleg (Sarud): Fizető Tag - 6 000 Ft',
    });
    // The payment itself is gone: the Napló still says what it was and who
    // had recorded it.
    expect(undone).toMatchObject({
      action: 'cash-undo',
      actorName: 'Másik Admin',
      summary: 'Készpénzes fizetés visszavonva: előleg (Sarud): Fizető Tag - 6 000 Ft',
    });
    expect(undone.details).toMatchObject({ amount: 6000, recordedByName: 'Pénztáros' });
    // The only e-mail is the tour's own "everyone paid" one.
    const subjects = vi.mocked(sendResendEmail).mock.calls.map(([mail]) => mail.subject);
    expect(subjects).toEqual(['Mindenki befizette az előleget - Sarud']);
  });

  it("a member's dues and their undo", async () => {
    const admin = await createAdmin({ name: 'Pénztáros' });
    const member = await createMember({ name: 'Fizető Tag' });
    const paid = await request(app)
      .post('/payments/cash-membership')
      .set(asUser(admin))
      .send({ userId: member._id, year });
    expect(paid.status).toBe(201);
    await request(app).delete(`/payments/${paid.body.data.payment._id}`).set(asUser(admin));

    const entries = await AuditLog.find().sort({ _id: 1 });
    expect(entries.map((e) => e.action)).toEqual(['cash-membership', 'cash-undo']);
    expect(entries[0]).toMatchObject({
      targetName: 'Fizető Tag',
      summary: `Készpénzes tagdíj: Fizető Tag, ${year}. év - 1 000 Ft`,
    });
    expect(entries[1].summary).toBe(
      `Készpénzes fizetés visszavonva: tagdíj (Fizető Tag, ${year}. év) - 1 000 Ft`,
    );
    expect(entries[1].targetName).toBe('Fizető Tag');
    expect(sendResendEmail).not.toHaveBeenCalled();
  });
});

describe('Kiutalás a számlára', () => {
  const withdraw = (admin) =>
    request(app)
      .post('/payments/withdraw')
      .set(asUser(admin))
      .send({ purpose: 'tourAdvance', amount: 10000 });

  it('is in the Napló with the account it went to, and e-mailed to every admin', async () => {
    const admin = await createAdmin({ name: 'Pénztáros' });
    expect((await withdraw(admin)).status).toBe(200);
    expect(await AuditLog.findOne()).toMatchObject({
      action: 'withdrawal',
      actorName: 'Pénztáros',
      summary: `Kiutalás a számlára (Előlegek): 10 000 Ft → Teszt Klub, ${IBAN}`,
      details: { amount: 10000, fee: 70, net: 9930, iban: IBAN, barionTransactionId: 'tx-test' },
    });
    const mail = vi.mocked(sendResendEmail).mock.calls[0][0];
    expect(mail.to).toEqual([admin.email]);
    expect(mail.subject).toContain('Kiutalás a számlára');
  });

  it('a failed payout leaves no line', async () => {
    vi.mocked(createBarionWithdrawal).mockRejectedValueOnce(new Error('down'));
    expect((await withdraw(await createAdmin())).status).toBe(502);
    expect(await AuditLog.countDocuments()).toBe(0);
    expect(sendResendEmail).not.toHaveBeenCalled();
  });
});

describe('Napló (Klub → Napló)', () => {
  const get = (user, query = '') =>
    request(app).get(`/settings/audit-log${query}`).set(asUser(user));

  it("shows the operations and the settings' changes together, newest first", async () => {
    const admin = await createAdmin({ name: 'Gazda' });
    await request(app).put('/settings/barion/tour').set(asUser(admin)).send({
      payeeEmail: 'tour@test.local',
      withdrawName: 'Valaki Más',
      withdrawIban: IBAN,
    });
    await request(app)
      .post('/payments/withdraw')
      .set(asUser(admin))
      .send({ purpose: 'tourAdvance', amount: 10000 });
    const settings = await getClubSettings();
    settings.history.push({
      at: new Date(Date.now() - 3600000),
      byName: 'Régi Admin',
      change: 'Tagdíj: 3000 → 5000',
    });
    await settings.save();

    const { entries, hasMore } = (await get(admin)).body.data;
    expect(entries.map((e) => [e.action, e.actorName, e.summary])).toEqual([
      ['withdrawal', 'Gazda', `Kiutalás a számlára (Előlegek): 10 000 Ft → Valaki Más, ${IBAN}`],
      ['barion-settings', 'Gazda', 'Barion (Előlegek): Számlatulajdonos: Teszt Klub → Valaki Más'],
      ['settings', 'Régi Admin', 'Tagdíj: 3000 → 5000'],
    ]);
    expect(new Set(entries.map((e) => e._id)).size).toBe(3);
    expect(hasMore).toBe(false);
  });

  it('fifty at a time, the older ones asked for by the last one shown', async () => {
    const admin = await createAdmin();
    const base = Date.now();
    await AuditLog.insertMany(
      Array.from({ length: 53 }, (_, i) => ({
        at: new Date(base - (i + 1) * 60000),
        action: 'cash-membership',
        actor: admin._id,
        actorName: admin.name,
        summary: `sor ${i}`,
        details: { amount: 1000 },
      })),
    );
    // Two settings' changes: the newest of all, and the oldest of all.
    const settings = await getClubSettings();
    settings.history.push({ at: new Date(base), byName: 'Gazda', change: 'legújabb' });
    settings.history.push({
      at: new Date(base - 90 * 60000),
      byName: 'Gazda',
      change: 'legrégebbi',
    });
    await settings.save();

    const first = (await get(admin)).body.data;
    expect(first.entries).toHaveLength(50);
    expect(first.entries[0].summary).toBe('legújabb');
    expect(first.entries[1]).toMatchObject({ summary: 'sor 0', actorName: admin.name });
    expect(first.entries[1].details).toBeUndefined();
    expect(first.hasMore).toBe(true);

    const rest = (await get(admin, `?before=${first.entries[49].at}`)).body.data;
    expect(rest.entries.map((e) => e.summary)).toEqual([
      'sor 49',
      'sor 50',
      'sor 51',
      'sor 52',
      'legrégebbi',
    ]);
    expect(rest.hasMore).toBe(false);
  });

  it('admins only', async () => {
    expect((await get(await createMember())).status).toBe(403);
    expect((await request(app).get('/settings/audit-log')).status).toBe(401);
  });
});
