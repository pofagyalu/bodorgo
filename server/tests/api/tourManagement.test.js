import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createGuest, createMember, createReservation, createTour } from '../helpers/factories.js';
import Tour from '../../src/models/tourModel.js';
import Reservation from '../../src/models/reservationModel.js';
import { fetchForecast, fetchHistorical } from '../../src/utils/weather.js';

describe('reading tours', () => {
  it('a tour page carries payments, attendee photos and usernames', async () => {
    const tour = await createTour({ accommodationPricePerNight: 1000, advancePaymentPercentage: 20 });
    const withPhoto = await createMember({ photoUpdatedAt: new Date(), username: 'fotos' });
    const plain = await createMember();
    await createReservation(tour, [withPhoto, plain]);
    const res = await request(app).get(`/tours/${tour._id}`).set(asUser(plain));
    expect(res.status).toBe(200);
    expect(res.body.data.attendeePayments).toHaveLength(2);
    expect(res.body.data.paymentTotals.totalPrice).toBe(2000);
    expect(Object.keys(res.body.data.userPhotos)).toEqual([String(withPhoto._id)]);
    expect(res.body.data.usernames).toEqual({ [String(withPhoto._id)]: 'fotos' });
    expect(res.body.data.participantCount).toBe(2);
  });

  it('404s for an unknown tour', async () => {
    const res = await request(app).get('/tours/nincs-ilyen').set(asUser(await createMember()));
    expect(res.status).toBe(404);
    // Every answer tells search engines to stay away.
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('fills in the weather: forecast for upcoming days, final history for past days', async () => {
    vi.mocked(fetchForecast).mockResolvedValue({ condition: 'clear', tempDayC: 25, tempNightC: 12 });
    vi.mocked(fetchHistorical).mockResolvedValue({ condition: 'rain', tempDayC: 15, tempNightC: 8 });
    const soon = await createTour({ startDate: new Date(Date.now() + 2 * 24 * 3600 * 1000), duration: 2 });
    const past = await createTour({ startDate: new Date('2023-05-01'), duration: 2 });
    const member = await createMember();
    await request(app).get(`/tours/${soon._id}`).set(asUser(member));
    await request(app).get(`/tours/${past._id}`).set(asUser(member));
    const savedSoon = await Tour.findById(soon._id);
    const savedPast = await Tour.findById(past._id);
    expect(savedSoon.dailyWeather).toHaveLength(2);
    expect(savedSoon.dailyWeather[0]).toMatchObject({ condition: 'clear', isFinal: false });
    expect(savedPast.dailyWeather.every((w) => w.isFinal)).toBe(true);
    // Day 1 is the tour's own start date - not the day before (the old
    // UTC conversion shifted every day back by one in Hungarian time).
    const askedDates = vi.mocked(fetchHistorical).mock.calls.map(([, , date]) => date).sort();
    expect(askedDates).toEqual(['2023-05-01', '2023-05-02']);
    // Past days are final: never fetched again.
    vi.mocked(fetchHistorical).mockClear();
    await request(app).get(`/tours/${past._id}`).set(asUser(member));
    expect(fetchHistorical).not.toHaveBeenCalled();
  });

  it('serves the last 3 tours, stats and the monthly plan to logged-in users', async () => {
    for (let i = 0; i < 4; i++) await createTour({ startDate: new Date(`2024-0${i + 1}-10`) });
    const member = await createMember();
    const last3 = await request(app).get('/tours/last-3').set(asUser(member));
    expect(last3.body.data.tours).toHaveLength(3);
    expect((await request(app).get('/tours/tour-stats').set(asUser(member))).status).toBe(200);
    expect((await request(app).get('/tours/montly-plan/2024').set(asUser(member))).status).toBe(200);
    expect((await request(app).get('/tours/tour-stats')).status).toBe(401);
  });

  it('supports filtering, sorting, field selection and paging on the list', async () => {
    await createTour({ title: 'A', duration: 2 });
    await createTour({ title: 'B', duration: 5 });
    const member = await createMember();
    // (Bracket filters like duration[gte]=3 aren't parsed by Express 5's
    // default query parser - unused by the app, so not tested here.)
    const res = await request(app).get('/tours?duration=5&sort=-duration&fields=title,duration&page=1&limit=5').set(asUser(member));
    expect(res.status).toBe(200);
    expect(res.body.data.tours.map((t) => t.title)).toEqual(['B']);
  });
});

describe('editing and deleting tours (admin)', () => {
  it('updates fields and refuses an order number another tour already uses', async () => {
    const admin = await createAdmin();
    const a = await createTour();
    const b = await createTour();
    const res = await request(app).patch(`/tours/${a._id}`).set(asUser(admin)).send({ title: 'Átnevezve' });
    expect(res.status).toBe(200);
    expect(res.body.data.tour.title).toBe('Átnevezve');
    const clash = await request(app).patch(`/tours/${a._id}`).set(asUser(admin)).send({ order: b.order });
    expect(clash.status).toBe(400);
    expect((await request(app).patch('/tours/000000000000000000000000').set(asUser(admin)).send({})).status).toBe(404);
  });

  it('marks everyone paid when the advance is set to exactly 0%', async () => {
    const admin = await createAdmin();
    const tour = await createTour({ accommodationPricePerNight: 1000, advancePaymentPercentage: 20 });
    await createReservation(tour, [await createMember(), await createMember()]);
    await request(app).patch(`/tours/${tour._id}`).set(asUser(admin)).send({ advancePaymentPercentage: 0 });
    const r = await Reservation.findOne({ tour: tour._id });
    expect(r.attendees.every((a) => a.paid)).toBe(true);
  });

  it('refuses a duplicate order number when creating', async () => {
    const admin = await createAdmin();
    const existing = await createTour();
    const res = await request(app).post('/tours').set(asUser(admin)).send({ order: existing.order, title: 'x' });
    expect(res.status).toBe(400);
    expect((await request(app).post('/tours').set(asUser(admin)).send({ title: 'no order' })).status).toBe(400);
  });

  it('deletes a tour', async () => {
    const admin = await createAdmin();
    const tour = await createTour();
    expect((await request(app).delete(`/tours/${tour._id}`).set(asUser(admin))).status).toBe(204);
    expect(await Tour.findById(tour._id)).toBeNull();
    expect((await request(app).delete(`/tours/${tour._id}`).set(asUser(admin))).status).toBe(404);
  });
});

describe('program schedule', () => {
  async function tourWithOptionalEvent() {
    const admin = await createAdmin();
    const tour = await createTour();
    const created = await request(app)
      .post(`/tours/${tour._id}/schedule`)
      .set(asUser(admin))
      .send({ day: 2, time: '17:00', description: 'Borkóstoló', isOptional: true, extraCost: 3000 });
    return { admin, tour, event: created.body.data.event, status: created.status };
  }

  it('admin adds and edits events; incomplete events are refused', async () => {
    const { admin, tour, event, status } = await tourWithOptionalEvent();
    expect(status).toBe(201);
    expect(event).toMatchObject({ day: 2, isOptional: true, extraCost: 3000 });
    const bad = await request(app).post(`/tours/${tour._id}/schedule`).set(asUser(admin)).send({ day: 1 });
    expect(bad.status).toBe(400);
    const edited = await request(app)
      .patch(`/tours/${tour._id}/schedule/${event._id}`)
      .set(asUser(admin))
      .send({ time: '18:00', isOptional: false });
    expect(edited.body.data.event).toMatchObject({ time: '18:00', isOptional: false });
    expect(edited.body.data.event.extraCost).toBeUndefined();
    expect((await request(app).patch(`/tours/${tour._id}/schedule/000000000000000000000000`).set(asUser(admin)).send({})).status).toBe(404);
  });

  it('a member signs up themselves and family, not strangers', async () => {
    const { tour, event } = await tourWithOptionalEvent();
    const member = await createMember();
    const kid = await createMember({ familyId: member.familyId });
    const stranger = await createGuest();
    await createReservation(tour, [member, kid]);
    await createReservation(tour, [stranger]);
    const url = `/tours/${tour._id}/schedule/${event._id}/participants`;
    const ok = await request(app).patch(url).set(asUser(member)).send({ userIds: [String(member._id), String(kid._id)] });
    expect(ok.status).toBe(200);
    expect(ok.body.data.participants).toHaveLength(2);
    const no = await request(app).patch(url).set(asUser(member)).send({ userIds: [String(stranger._id)] });
    expect(no.status).toBe(403);
    expect((await request(app).patch(url).set(asUser(member)).send({ userIds: 'x' })).status).toBe(400);
    // The stranger's own sign-up leaves the family's in place.
    await request(app).patch(url).set(asUser(stranger)).send({ userIds: [String(stranger._id)] });
    const saved = (await Tour.findById(tour._id)).schedule.id(event._id);
    expect(saved.participants).toHaveLength(3);
  });

  it('refuses sign-ups for a non-optional event', async () => {
    const admin = await createAdmin();
    const tour = await createTour();
    const created = await request(app)
      .post(`/tours/${tour._id}/schedule`)
      .set(asUser(admin))
      .send({ day: 1, time: '9:00', description: 'Reggeli' });
    const res = await request(app)
      .patch(`/tours/${tour._id}/schedule/${created.body.data.event._id}/participants`)
      .set(asUser(admin))
      .send({ userIds: [] });
    expect(res.status).toBe(400);
  });
});
