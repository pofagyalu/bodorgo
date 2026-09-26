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
import Tour from '../../src/models/tourModel.js';
import { tourHasEnded } from '../../src/controllers/reviewController.js';

describe('finance ledger', () => {
  const tx = {
    date: '2026-01-10',
    name: ' Szállás előleg ',
    type: 'expense',
    category: 'Szállásköltség',
    amount: 50000,
  };

  it('admin records income/expense; members can read, guests cannot', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .post('/finance/transactions')
      .set(asUser(admin))
      .send({ ...tx, currency: 'EUR' });
    expect(res.status).toBe(201);
    expect(res.body.data.transaction).toMatchObject({ name: 'Szállás előleg', currency: 'EUR' });
    const list = await request(app)
      .get('/finance/transactions')
      .set(asUser(await createMember()));
    expect(list.body.data.transactions).toHaveLength(1);
    expect(
      (
        await request(app)
          .get('/finance/transactions')
          .set(asUser(await createGuest()))
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/finance/transactions')
          .set(asUser(await createMember()))
          .send(tx)
      ).status,
    ).toBe(403);
  });

  it('validates the entry', async () => {
    const admin = await createAdmin();
    const post = (body) => request(app).post('/finance/transactions').set(asUser(admin)).send(body);
    expect((await post({ ...tx, name: '' })).status).toBe(400);
    expect((await post({ ...tx, type: 'gift' })).status).toBe(400);
    expect((await post({ ...tx, category: 'Tagdíj' })).status).toBe(400); // an income category
    expect((await post({ ...tx, amount: -1 })).status).toBe(400);
  });
});

describe('polls', () => {
  async function poll(overrides = {}) {
    const admin = await createAdmin();
    const tour = await createTour();
    const res = await request(app)
      .post('/polls')
      .set(asUser(admin))
      .send({
        tour: tour._id,
        question: 'Hová menjünk?',
        options: ['Mátra', ' Bükk ', ''],
        closesAt: new Date(Date.now() + 86400000).toISOString(),
        ...overrides,
      });
    return { admin, tour, res, id: res.body.data?.poll?._id };
  }

  it('admin creates a poll (blank options dropped, at least 2 needed)', async () => {
    const { res } = await poll();
    expect(res.status).toBe(201);
    expect(res.body.data.poll.options.map((o) => o.text)).toEqual(['Mátra', 'Bükk']);
    expect((await poll({ options: ['csak egy'] })).res.status).toBe(400);
  });

  it('results are hidden until I vote; voting again changes it; no votes after closing', async () => {
    const { id, res } = await poll();
    const voter = await createMember();
    const before = await request(app).get(`/polls/${id}`).set(asUser(voter));
    expect(before.body.data.poll.results).toBeNull();
    const optionId = res.body.data.poll.options[0]._id;
    const voted = await request(app)
      .post(`/polls/${id}/vote`)
      .set(asUser(voter))
      .send({ optionId });
    expect(voted.body.data.poll).toMatchObject({ hasVoted: true, totalVotes: 1 });
    expect(voted.body.data.poll.results[0]).toMatchObject({ count: 1, percentage: 100 });
    // Changing my mind: still one vote, now on the other answer.
    const otherId = res.body.data.poll.options[1]._id;
    const changed = await request(app)
      .post(`/polls/${id}/vote`)
      .set(asUser(voter))
      .send({ optionId: otherId });
    expect(changed.body.data.poll).toMatchObject({ totalVotes: 1, myOptionId: otherId });
    expect(
      (
        await request(app)
          .post(`/polls/${id}/vote`)
          .set(asUser(await createMember()))
          .send({ optionId: 'nope' })
      ).status,
    ).toBe(400);

    const closed = await poll({ closesAt: new Date(Date.now() - 1000).toISOString() });
    const late = await request(app)
      .post(`/polls/${closed.id}/vote`)
      .set(asUser(voter))
      .send({ optionId: closed.res.body.data.poll.options[0]._id });
    expect(late.status).toBe(400);
    const all = await request(app).get('/polls').set(asUser(voter));
    expect(all.body.data.polls).toHaveLength(2);
    // A closed poll shows its results to everyone.
    expect(all.body.data.polls.find((p) => p._id === closed.id).results).not.toBeNull();
  });

  it('question/options are locked once someone voted; closing date and tour stay editable', async () => {
    const { id, res, admin } = await poll();
    const edit = (body) => request(app).patch(`/polls/${id}`).set(asUser(admin)).send(body);
    expect((await edit({ question: 'Új kérdés?', options: ['A', 'B', 'C'] })).status).toBe(200);
    expect((await edit({ options: ['csak egy'] })).status).toBe(400);
    const optionId = (await request(app).get(`/polls/${id}`).set(asUser(admin))).body.data.poll
      .options[0]._id;
    await request(app).post(`/polls/${id}/vote`).set(asUser(admin)).send({ optionId });
    expect((await edit({ question: 'Még újabb?' })).status).toBe(400);
    expect((await edit({ closesAt: new Date(Date.now() + 2e8).toISOString() })).status).toBe(200);
    expect(res.status).toBe(201);
  });

  it('deletes, and 404s for unknown polls', async () => {
    const { id, admin } = await poll();
    expect((await request(app).delete(`/polls/${id}`).set(asUser(admin))).status).toBe(204);
    const unknown = '000000000000000000000000';
    expect((await request(app).get(`/polls/${unknown}`).set(asUser(admin))).status).toBe(404);
    expect((await request(app).patch(`/polls/${unknown}`).set(asUser(admin)).send({})).status).toBe(
      404,
    );
    expect((await request(app).delete(`/polls/${unknown}`).set(asUser(admin))).status).toBe(404);
    expect(
      (await request(app).post(`/polls/${unknown}/vote`).set(asUser(admin)).send({})).status,
    ).toBe(404);
  });
});

describe('tour reviews', () => {
  it('only attendees rate (1-10); a second rating replaces the first', async () => {
    const tour = await createTour({ startDate: new Date('2024-05-01'), duration: 3 });
    const attendee = await createMember();
    const outsider = await createMember();
    await createReservation(tour, [attendee]);
    const rate = (user, rating) =>
      request(app).put(`/tours/${tour._id}/reviews`).set(asUser(user)).send({ rating });

    expect(
      (await request(app).get(`/tours/${tour._id}/reviews/me`).set(asUser(outsider))).body.data,
    ).toEqual({ isAttendee: false, hasEnded: false, rating: null });
    expect((await rate(outsider, 8)).status).toBe(403);
    expect((await rate(attendee, 11)).status).toBe(400);
    expect((await rate(attendee, 8)).status).toBe(200);
    const second = await rate(attendee, 6);
    expect(second.body.data).toMatchObject({ rating: 6, ratingsQuantity: 1 });
    const mine = await request(app).get(`/tours/${tour._id}/reviews/me`).set(asUser(attendee));
    expect(mine.body.data).toEqual({ isAttendee: true, hasEnded: true, rating: 6 });
    expect((await Tour.findById(tour._id)).ratingsAverage).toBe(6);
  });

  it('an unfinished tour cannot be rated yet, not even by an attendee', async () => {
    const tour = await createTour(); // starts in 30 days
    const attendee = await createMember();
    await createReservation(tour, [attendee]);
    const mine = await request(app).get(`/tours/${tour._id}/reviews/me`).set(asUser(attendee));
    expect(mine.body.data).toEqual({ isAttendee: true, hasEnded: false, rating: null });
    const res = await request(app)
      .put(`/tours/${tour._id}/reviews`)
      .set(asUser(attendee))
      .send({ rating: 8 });
    expect(res.status).toBe(403);
  });

  it('a tour ends at midnight after its last day', () => {
    const tour = { startDate: new Date(2024, 4, 1), duration: 3 }; // 1-3 May
    expect(tourHasEnded(tour, new Date(2024, 4, 3, 23, 59))).toBe(false);
    expect(tourHasEnded(tour, new Date(2024, 4, 4, 0, 0))).toBe(true);
  });
});
