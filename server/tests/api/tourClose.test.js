import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember, createReservation, createTour } from '../helpers/factories.js';
import Tour from '../../src/models/tourModel.js';
import Reservation from '../../src/models/reservationModel.js';

const DAY = 24 * 3600 * 1000;
const pastTour = (overrides = {}) =>
  createTour({ startDate: new Date(Date.now() - 30 * DAY), duration: 3, ...overrides });

const PDF = Buffer.from('%PDF-1.4 test');
const uploadTourDocument = (user, tour) =>
  request(app)
    .post('/documents')
    .set(asUser(user))
    .field('name', 'Térkép')
    .field('tour', String(tour._id))
    .attach('file', PDF, { filename: 'x.pdf', contentType: 'application/pdf' });

describe('Lezárás - closing a tour for good', () => {
  it('only an admin closes it, only once it is over, and only once', async () => {
    const admin = await createAdmin();
    const member = await createMember();
    const upcoming = await createTour();
    const past = await pastTour();

    expect((await request(app).post(`/tours/${past._id}/close`).set(asUser(member))).status).toBe(
      403,
    );
    expect((await request(app).post(`/tours/${past._id}/close`)).status).toBe(401);
    expect(
      (await request(app).post(`/tours/${upcoming._id}/close`).set(asUser(admin))).status,
    ).toBe(400);

    const res = await request(app).post(`/tours/${past._id}/close`).set(asUser(admin));
    expect(res.status).toBe(200);
    expect(res.body.data.closed).toBe(true);
    const saved = await Tour.findById(past._id);
    expect(saved.closed).toBe(true);
    expect(saved.closedAt).toBeInstanceOf(Date);
    expect(String(saved.closedBy)).toBe(String(admin._id));

    expect((await request(app).post(`/tours/${past._id}/close`).set(asUser(admin))).status).toBe(
      400,
    );
    // The page gets it with the tour.
    const got = await request(app).get(`/tours/${past._id}`).set(asUser(member));
    expect(got.body.data.tour.closed).toBe(true);
  });

  it('cannot be closed or opened through the tour update or create', async () => {
    const admin = await createAdmin();
    const open = await pastTour();
    const patched = await request(app)
      .patch(`/tours/${open._id}`)
      .set(asUser(admin))
      .send({ closed: true, title: 'Új cím' });
    expect(patched.status).toBe(200);
    expect((await Tour.findById(open._id)).closed).toBe(false);

    const closed = await pastTour({ closed: true });
    const reopen = await request(app)
      .patch(`/tours/${closed._id}`)
      .set(asUser(admin))
      .send({ closed: false });
    expect(reopen.status).toBe(403);
    expect((await Tour.findById(closed._id)).closed).toBe(true);
  });

  it('a closed tour refuses every change, from an admin too', async () => {
    const admin = await createAdmin();
    const member = await createMember();
    const tour = await pastTour({
      schedule: [{ day: 1, time: '08:00', description: 'Reggeli', isOptional: true }],
    });
    const reservation = await createReservation(tour, [member]);
    const attendee = reservation.attendees[0];
    const event = tour.schedule[0];
    const document = (await uploadTourDocument(admin, tour)).body.data.document;
    await Tour.updateOne({ _id: tour._id }, { closed: true });

    const as = (user) => asUser(user);
    const id = tour._id;
    const attempts = {
      'update the tour': request(app).patch(`/tours/${id}`).set(as(admin)).send({ title: 'Más' }),
      'update by slug': request(app).patch(`/tours/${tour.slug}`).set(as(admin)).send({
        title: 'Más',
      }),
      'delete the tour': request(app).delete(`/tours/${id}`).set(as(admin)),
      'add an event': request(app)
        .post(`/tours/${id}/schedule`)
        .set(as(admin))
        .send({ day: 1, time: '10:00', description: 'Túra' }),
      'edit an event': request(app)
        .patch(`/tours/${id}/schedule/${event._id}`)
        .set(as(admin))
        .send({ time: '09:00', description: 'Reggeli' }),
      'opt in to an event': request(app)
        .patch(`/tours/${id}/schedule/${event._id}/participants`)
        .set(as(member))
        .send({ userIds: [String(member._id)] }),
      'sign up': request(app)
        .post(`/tours/${id}/signup`)
        .set(as(admin))
        .send({ attendeeIds: [String(admin._id)] }),
      withdraw: request(app)
        .delete(`/tours/${id}/reservations/${reservation._id}/attendees/${attendee._id}`)
        .set(as(admin)),
      'change nights': request(app)
        .patch(`/tours/${id}/reservations/${reservation._id}/attendees/${attendee._id}/nights`)
        .set(as(admin))
        .send({ nights: 1 }),
      'fee exempt': request(app)
        .patch(`/tours/${id}/reservations/${reservation._id}/attendees/${attendee._id}/fee-exempt`)
        .set(as(admin))
        .send({ feeExempt: true }),
      'reopen the beszámoló': request(app).post(`/tours/${id}/report/reopen`).set(as(admin)),
      'save a letter draft': request(app)
        .put(`/tours/${id}/mailings/draft`)
        .set(as(admin))
        .send({}),
      'send a letter': request(app).post(`/tours/${id}/mailings/send`).set(as(admin)).send({}),
      'save the accommodation': request(app)
        .put(`/tours/${id}/accommodation`)
        .set(as(admin))
        .send({ houses: [] }),
      'assign a room': request(app).put(`/tours/${id}/rooms/assignment`).set(as(admin)).send({}),
      'finalize the rooms': request(app)
        .put(`/tours/${id}/rooms/finalized`)
        .set(as(admin))
        .send({ finalized: true }),
      'restrict a photo': request(app)
        .patch(`/tours/${id}/images/x.jpg`)
        .set(as(admin))
        .send({ restricted: true }),
      'upload a document': uploadTourDocument(admin, tour),
      'delete a document': request(app).delete(`/documents/${document._id}`).set(as(admin)),
      'record a cash payment': request(app)
        .post('/payments/cash')
        .set(as(admin))
        .send({ tourId: String(id), attendeeIds: [String(attendee._id)] }),
      'start a payment': request(app)
        .post('/payments/start')
        .set(as(member))
        .send({ tourId: String(id), attendeeIds: [String(attendee._id)] }),
    };
    for (const [what, attempt] of Object.entries(attempts)) {
      const res = await attempt;
      expect(res.status, what).toBe(403);
    }

    // Nothing moved.
    const after = await Tour.findById(id);
    expect(after.title).toBe(tour.title);
    expect(after.schedule).toHaveLength(1);
    expect((await Reservation.findById(reservation._id)).attendees).toHaveLength(1);
    // Reading still works.
    expect((await request(app).get(`/tours/${id}`).set(as(member))).status).toBe(200);
    expect((await request(app).get(`/documents/${document._id}/file`).set(as(member))).status).toBe(
      200,
    );
  });

  it('the beszámoló can still be written on a closed tour - until it is Kész', async () => {
    const admin = await createAdmin();
    const tour = await pastTour({ closed: true });
    const days = [{ ops: [{ insert: 'Megérkeztünk.\n' }] }];
    const report = `/tours/${tour._id}/report`;

    expect((await request(app).put(report).set(asUser(admin)).send({ days })).status).toBe(200);
    expect((await request(app).post(`${report}/finish`).set(asUser(admin))).status).toBe(200);
    // Finished: frozen with the tour.
    expect((await request(app).put(report).set(asUser(admin)).send({ days })).status).toBe(403);
    expect((await request(app).post(`${report}/finish`).set(asUser(admin))).status).toBe(403);
    expect((await request(app).post(`${report}/reopen`).set(asUser(admin))).status).toBe(403);
    // Still downloadable.
    expect((await request(app).get(`${report}/pdf`).set(asUser(admin))).status).toBe(200);
  });
});
