import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import {
  createAdmin,
  createGuest,
  createMember,
  createReservation,
  createTour,
} from '../helpers/factories.js';
import Reservation from '../../src/models/reservationModel.js';
import sendResendEmail from '../../src/utils/resendEmail.js';

const signUp = (tour, user, attendeeIds) =>
  request(app)
    .post(`/tours/${tour._id}/signup`)
    .set(asUser(user))
    .send(attendeeIds ? { attendeeIds } : {});

describe('signing up for a tour', () => {
  it('needs a login', async () => {
    const tour = await createTour();
    expect((await request(app).post(`/tours/${tour._id}/signup`)).status).toBe(401);
  });

  it('registers the caller themselves by default, with duration - 1 nights, and emails them', async () => {
    const tour = await createTour({ duration: 4 });
    const member = await createMember({ lastLoginAt: new Date() });
    const res = await signUp(tour, member);
    expect(res.status).toBe(201);
    const saved = await Reservation.findOne({ tour: tour._id });
    expect(saved.attendees).toHaveLength(1);
    expect(saved.attendees[0].nights).toBe(3);
    expect(String(saved.bookedBy)).toBe(String(member._id));
    expect(sendResendEmail).toHaveBeenCalledOnce();
  });

  it('lets a member register their family, but nobody else', async () => {
    const tour = await createTour();
    const member = await createMember();
    const spouse = await createMember({ familyId: member.familyId });
    const stranger = await createMember();
    expect((await signUp(tour, member, [String(member._id), String(spouse._id)])).status).toBe(201);
    const res = await signUp(await createTour(), member, [String(stranger._id)]);
    expect(res.status).toBe(403);
  });

  it('lets a guest register only themselves', async () => {
    const tour = await createTour();
    const guest = await createGuest();
    const other = await createGuest();
    expect((await signUp(tour, guest, [String(other._id)])).status).toBe(403);
    expect((await signUp(tour, guest, [String(guest._id)])).status).toBe(201);
  });

  it('lets an admin register anyone', async () => {
    const tour = await createTour();
    const admin = await createAdmin();
    const a = await createMember();
    const b = await createGuest();
    const res = await signUp(tour, admin, [String(a._id), String(b._id)]);
    expect(res.status).toBe(201);
    expect((await Reservation.findOne({ tour: tour._id })).attendees).toHaveLength(2);
  });

  it('refuses someone who is already registered', async () => {
    const tour = await createTour();
    const member = await createMember();
    await createReservation(tour, [member]);
    const res = await signUp(tour, member);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('már jelentkezett');
  });

  it('refuses when the tour is full', async () => {
    const tour = await createTour({ maxCapacity: 1 });
    await createReservation(tour, [await createMember()]);
    const res = await signUp(tour, await createMember());
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('megtelt');
  });

  it('is closed to members and guests once the tour has started', async () => {
    const hourAgo = new Date(Date.now() - 3600 * 1000);
    const started = await createTour({ startDate: hourAgo });
    const longPast = await createTour({ startDate: new Date('2019-07-10') });
    for (const tour of [started, longPast]) {
      const member = await createMember();
      const res = await signUp(tour, member);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('már nem lehet jelentkezni');
      expect((await signUp(tour, await createGuest())).status).toBe(400);
    }
    expect(await Reservation.countDocuments()).toBe(0);
  });

  it('an admin can still register anyone for a started or past tour (backfilling)', async () => {
    const admin = await createAdmin();
    const member = await createMember();
    const past = await createTour({ startDate: new Date('2019-07-10') });
    const res = await signUp(past, admin, [member._id]);
    expect(res.status).toBe(201);
    expect(res.body.data.reservation.attendees[0].user).toBe(String(member._id));
  });

  it('404s for an unknown tour or unknown attendee', async () => {
    const admin = await createAdmin();
    const tour = await createTour();
    expect(
      (await request(app).post('/tours/000000000000000000000000/signup').set(asUser(admin))).status,
    ).toBe(404);
    expect((await signUp(tour, admin, ['000000000000000000000000'])).status).toBe(404);
  });

  it('still succeeds when the confirmation email fails', async () => {
    const { vi } = await import('vitest');
    vi.mocked(sendResendEmail).mockRejectedValueOnce(new Error('email down'));
    const tour = await createTour();
    const res = await signUp(tour, await createMember({ lastLoginAt: new Date() }));
    expect(res.status).toBe(201);
  });
});

describe('admin corrections on an attendee', () => {
  async function setup() {
    const tour = await createTour({ duration: 4 });
    const member = await createMember();
    const reservation = await createReservation(tour, [member]);
    const attendee = reservation.attendees[0];
    const base = `/tours/${tour._id}/reservations/${reservation._id}/attendees/${attendee._id}`;
    return { tour, member, reservation, attendee, base, admin: await createAdmin() };
  }

  it('changes the nights, within 0..duration-1, admin only', async () => {
    const { base, admin, member, reservation } = await setup();
    expect(
      (await request(app).patch(`${base}/nights`).set(asUser(member)).send({ nights: 1 })).status,
    ).toBe(403);
    expect(
      (await request(app).patch(`${base}/nights`).set(asUser(admin)).send({ nights: 4 })).status,
    ).toBe(400);
    expect(
      (await request(app).patch(`${base}/nights`).set(asUser(admin)).send({ nights: -1 })).status,
    ).toBe(400);
    expect(
      (await request(app).patch(`${base}/nights`).set(asUser(admin)).send({ nights: 'x' })).status,
    ).toBe(400);
    const res = await request(app).patch(`${base}/nights`).set(asUser(admin)).send({ nights: 2 });
    expect(res.status).toBe(200);
    expect((await Reservation.findById(reservation._id)).attendees[0].nights).toBe(2);
  });

  it('marks someone fee-exempt (and therefore paid)', async () => {
    const { base, admin, reservation } = await setup();
    expect(
      (await request(app).patch(`${base}/fee-exempt`).set(asUser(admin)).send({ feeExempt: 'yes' }))
        .status,
    ).toBe(400);
    const res = await request(app)
      .patch(`${base}/fee-exempt`)
      .set(asUser(admin))
      .send({ feeExempt: true });
    expect(res.status).toBe(200);
    const saved = (await Reservation.findById(reservation._id)).attendees[0];
    expect(saved.feeExempt).toBe(true);
    expect(saved.paid).toBe(true);
  });

  it('404s for an unknown reservation or attendee', async () => {
    const { tour, admin, reservation } = await setup();
    const unknown = '000000000000000000000000';
    const r1 = await request(app)
      .patch(`/tours/${tour._id}/reservations/${unknown}/attendees/${unknown}/nights`)
      .set(asUser(admin))
      .send({ nights: 1 });
    expect(r1.status).toBe(404);
    const r2 = await request(app)
      .patch(`/tours/${tour._id}/reservations/${reservation._id}/attendees/${unknown}/fee-exempt`)
      .set(asUser(admin))
      .send({ feeExempt: true });
    expect(r2.status).toBe(404);
  });
});
