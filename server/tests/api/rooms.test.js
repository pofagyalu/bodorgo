import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember, createReservation, createTour } from '../helpers/factories.js';
import Reservation from '../../src/models/reservationModel.js';

const HOUSES = [
  {
    name: 'Nagy ház',
    description: 'itt van a buliszoba',
    rooms: [
      { name: '1-es szoba', description: 'franciaágy', beds: 2 },
      { name: '2-es szoba', description: '', beds: 1 },
    ],
  },
];

async function tourWithRooms() {
  const admin = await createAdmin();
  const tour = await createTour();
  const saved = await request(app).put(`/tours/${tour._id}/accommodation`).set(asUser(admin)).send({ houses: HOUSES });
  const [room1, room2] = saved.body.data.accommodation.houses[0].rooms;
  return { admin, tour, saved, room1, room2 };
}

describe('Szállás (accommodation setup)', () => {
  it('admin saves houses and rooms; ids are kept on later edits', async () => {
    const { admin, tour, saved, room1 } = await tourWithRooms();
    expect(saved.status).toBe(200);
    const house = saved.body.data.accommodation.houses[0];
    const renamed = await request(app)
      .put(`/tours/${tour._id}/accommodation`)
      .set(asUser(admin))
      .send({ houses: [{ ...house, rooms: [{ ...room1, name: 'Átnevezve' }] }] });
    expect(renamed.body.data.accommodation.houses[0].rooms[0]).toMatchObject({ _id: room1._id, name: 'Átnevezve' });
  });

  it('validates names and bed counts, admin only', async () => {
    const { admin, tour } = await tourWithRooms();
    const put = (body, user = admin) => request(app).put(`/tours/${tour._id}/accommodation`).set(asUser(user)).send(body);
    expect((await put({ houses: 'x' })).status).toBe(400);
    expect((await put({ houses: [{ name: '', rooms: [] }] })).status).toBeGreaterThanOrEqual(400);
    expect((await put({ houses: [{ name: 'H', rooms: [{ name: 'R', beds: 0 }] }] })).status).toBeGreaterThanOrEqual(400);
    expect((await put({ houses: [] }, await createMember())).status).toBe(403);
    expect((await request(app).put('/tours/000000000000000000000000/accommodation').set(asUser(admin)).send({ houses: [] })).status).toBe(404);
  });
});

describe('Szobabeosztás (room allocation)', () => {
  it('shows everyone the board; admin places people, full rooms refuse', async () => {
    const { admin, tour, room2 } = await tourWithRooms();
    const a = await createMember();
    const b = await createMember();
    const reservation = await createReservation(tour, [a, b]);
    const [attA, attB] = reservation.attendees;
    const assign = (attendeeId, roomId, user = admin) =>
      request(app).put(`/tours/${tour._id}/rooms/assignment`).set(asUser(user)).send({ attendeeId, roomId });

    expect((await assign(attA._id, room2._id, a)).status).toBe(403);
    expect((await assign(attA._id, room2._id)).status).toBe(200);
    const full = await assign(attB._id, room2._id);
    expect(full.status).toBe(409);
    expect(full.body.message).toContain('tele');

    const board = await request(app).get(`/tours/${tour._id}/rooms`).set(asUser(b));
    expect(board.status).toBe(200);
    const people = Object.fromEntries(board.body.data.people.map((p) => [p.attendeeId, p.roomId]));
    expect(people[String(attA._id)]).toBe(room2._id);
    expect(people[String(attB._id)]).toBeNull();

    // Taking someone out of their room.
    expect((await assign(attA._id, null)).status).toBe(200);
    expect((await Reservation.findById(reservation._id)).attendees[0].room).toBeUndefined();
  });

  it('rejects unknown people and rooms', async () => {
    const { admin, tour, room1 } = await tourWithRooms();
    const put = (body) => request(app).put(`/tours/${tour._id}/rooms/assignment`).set(asUser(admin)).send(body);
    expect((await put({ attendeeId: 'x', roomId: room1._id })).status).toBe(400);
    expect((await put({ attendeeId: '000000000000000000000000', roomId: '000000000000000000000000' })).status).toBe(400);
    expect((await put({ attendeeId: '000000000000000000000000', roomId: room1._id })).status).toBe(404);
  });

  it('while finalized nobody can be moved', async () => {
    const { admin, tour, room1 } = await tourWithRooms();
    const reservation = await createReservation(tour, [await createMember()]);
    const fin = await request(app).put(`/tours/${tour._id}/rooms/finalized`).set(asUser(admin)).send({ finalized: true });
    expect(fin.body.data.finalized).toBe(true);
    const res = await request(app)
      .put(`/tours/${tour._id}/rooms/assignment`)
      .set(asUser(admin))
      .send({ attendeeId: reservation.attendees[0]._id, roomId: room1._id });
    expect(res.status).toBe(409);
    // Editing the Szállás keeps the finalized flag.
    await request(app).put(`/tours/${tour._id}/accommodation`).set(asUser(admin)).send({ houses: HOUSES });
    const board = await request(app).get(`/tours/${tour._id}/rooms`).set(asUser(admin));
    expect(board.body.data.finalized).toBe(true);
  });

  it('people in a deleted room go back to "no room"', async () => {
    const { admin, tour, room1 } = await tourWithRooms();
    const reservation = await createReservation(tour, [await createMember()]);
    await request(app)
      .put(`/tours/${tour._id}/rooms/assignment`)
      .set(asUser(admin))
      .send({ attendeeId: reservation.attendees[0]._id, roomId: room1._id });
    await request(app).put(`/tours/${tour._id}/accommodation`).set(asUser(admin)).send({ houses: [] });
    expect((await Reservation.findById(reservation._id)).attendees[0].room).toBeUndefined();
  });

  it('404s for an unknown tour', async () => {
    const res = await request(app).get('/tours/000000000000000000000000/rooms').set(asUser(await createMember()));
    expect(res.status).toBe(404);
  });
});
