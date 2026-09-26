import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createGuest, createMember, createReservation, createTour } from '../helpers/factories.js';
import Reservation from '../../src/models/reservationModel.js';
import Tour from '../../src/models/tourModel.js';
import sendResendEmail from '../../src/utils/resendEmail.js';

const url = (tour, reservation, attendee) =>
  `/tours/${tour._id}/reservations/${reservation._id}/attendees/${attendee._id}`;

describe('Lemondás - withdrawing someone from a tour', () => {
  it('a member takes a family member off; both get a short confirmation', async () => {
    const parent = await createMember({ name: 'Anya', lastLoginAt: new Date() });
    const kid = await createMember({ name: 'Gyerek', familyId: parent.familyId, lastLoginAt: new Date() });
    const tour = await createTour({ title: 'Sarud' });
    const reservation = await createReservation(tour, [parent, kid]);
    const kidAttendee = reservation.attendees[1];

    const res = await request(app)
      .delete(url(tour, reservation, kidAttendee))
      .set(asUser(parent))
      .send({ reason: 'beteg lett' });
    expect(res.status).toBe(200);

    const left = await Reservation.findById(reservation._id);
    expect(left.attendees.map((a) => a.name)).toEqual(['Anya']);
    const emails = vi.mocked(sendResendEmail).mock.calls.map(([e]) => e);
    expect(emails.map((e) => e.to).sort()).toEqual([parent.email, kid.email].sort());
    expect(emails.find((e) => e.to === kid.email).text).toContain('jelentkezésedet visszavontuk');

    // It's in the admins' list, with the reason.
    const list = await request(app).get(`/tours/${tour._id}/cancellations`).set(asUser(await createAdmin()));
    expect(list.body.data.cancellations).toEqual([
      expect.objectContaining({ name: 'Gyerek', reason: 'beteg lett', cancelledByName: 'Anya', wasPaid: false }),
    ]);
    expect((await request(app).get(`/tours/${tour._id}/cancellations`).set(asUser(parent))).status).toBe(403);
  });

  it("only whoever could sign them up - a stranger can't, an admin can", async () => {
    const owner = await createMember();
    const stranger = await createMember();
    const guest = await createGuest();
    const tour = await createTour();
    const reservation = await createReservation(tour, [owner]);
    const target = url(tour, reservation, reservation.attendees[0]);

    expect((await request(app).delete(target).set(asUser(stranger))).status).toBe(403);
    expect((await request(app).delete(target).set(asUser(guest))).status).toBe(403);
    expect((await request(app).delete(target)).status).toBe(401);
    expect((await request(app).delete(target).set(asUser(await createAdmin()))).status).toBe(200);
    // A reservation from another tour's address is not found.
    const other = await createTour();
    const wrong = `/tours/${other._id}/reservations/${reservation._id}/attendees/${reservation.attendees[0]._id}`;
    expect((await request(app).delete(wrong).set(asUser(await createAdmin()))).status).toBe(404);
  });

  it('frees the room and programs, reopens the room plan, flags a paid advance; can sign up again', async () => {
    const member = await createMember({ lastLoginAt: new Date() });
    const roomId = new mongoose.Types.ObjectId();
    const tour = await createTour({
      accommodation: { finalized: true, houses: [{ name: 'Ház', rooms: [{ _id: roomId, name: 'Szoba', beds: 2 }] }] },
      schedule: [
        {
          day: 1,
          time: '18:00',
          description: 'Borkóstoló',
          isOptional: true,
          participants: [{ user: member._id, name: member.name }],
        },
      ],
    });
    const reservation = await createReservation(tour, [member]);
    reservation.attendees[0].room = roomId;
    reservation.attendees[0].paid = true;
    await reservation.save();

    const res = await request(app).delete(url(tour, reservation, reservation.attendees[0])).set(asUser(member));
    expect(res.body.data).toMatchObject({ wasPaid: true, roomsReopened: true });

    // The last one on it - the reservation itself is gone.
    expect(await Reservation.findById(reservation._id)).toBeNull();
    const saved = await Tour.findById(tour._id);
    expect(saved.accommodation.finalized).toBe(false);
    expect(saved.schedule[0].participants).toHaveLength(0);

    // Signing up again works as usual.
    expect((await request(app).post(`/tours/${tour._id}/signup`).set(asUser(member)).send({})).status).toBe(201);
  });
});
