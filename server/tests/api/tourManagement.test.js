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
import User from '../../src/models/userModel.js';
import Tour from '../../src/models/tourModel.js';
import Reservation from '../../src/models/reservationModel.js';
import { fetchForecast, fetchHistorical } from '../../src/utils/weather.js';
import { refreshToursWeather } from '../../src/controllers/tourController.js';

describe('reading tours', () => {
  it('a tour page carries payments, attendee photos and usernames', async () => {
    const tour = await createTour({
      accommodationPricePerNight: 1000,
      advancePaymentPercentage: 20,
    });
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
    const res = await request(app)
      .get('/tours/nincs-ilyen')
      .set(asUser(await createMember()));
    expect(res.status).toBe(404);
    // Every answer tells search engines to stay away.
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('fills in the weather: forecast for upcoming days, final history for past days', async () => {
    vi.mocked(fetchForecast).mockResolvedValue({
      condition: 'clear',
      tempDayC: 25,
      tempNightC: 12,
    });
    vi.mocked(fetchHistorical).mockResolvedValue({
      condition: 'rain',
      tempDayC: 15,
      tempNightC: 8,
    });
    const soon = await createTour({
      startDate: new Date(Date.now() + 2 * 24 * 3600 * 1000),
      duration: 2,
    });
    const past = await createTour({ startDate: new Date('2023-05-01'), duration: 2 });
    await refreshToursWeather();
    await refreshToursWeather();
    const savedSoon = await Tour.findById(soon._id);
    const savedPast = await Tour.findById(past._id);
    expect(savedSoon.dailyWeather).toHaveLength(2);
    expect(savedSoon.dailyWeather[0]).toMatchObject({ condition: 'clear', isFinal: false });
    expect(savedPast.dailyWeather.every((w) => w.isFinal)).toBe(true);
    // Day 1 is the tour's own start date - not the day before (the old
    // UTC conversion shifted every day back by one in Hungarian time).
    const askedDates = vi
      .mocked(fetchHistorical)
      .mock.calls.map(([, , date]) => date)
      .sort();
    expect(askedDates).toEqual(['2023-05-01', '2023-05-02']);
    // Past days are final: never fetched again.
    vi.mocked(fetchHistorical).mockClear();
    await refreshToursWeather();
    expect(fetchHistorical).not.toHaveBeenCalled();
  });

  it('a page view never asks for the weather; the round asks each day once, one at a time', async () => {
    let running = 0;
    let most = 0;
    vi.mocked(fetchForecast)
      .mockClear()
      .mockImplementation(async () => {
        running += 1;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return { condition: 'clear', tempDayC: 20, tempNightC: 10 };
      });
    const soon = await createTour({
      startDate: new Date(Date.now() + 3 * 24 * 3600 * 1000),
      duration: 3,
    });
    const member = await createMember();
    const [list, page] = await Promise.all([
      request(app).get('/tours').set(asUser(member)),
      request(app).get(`/tours/${soon._id}`).set(asUser(member)),
    ]);
    expect(list.status).toBe(200);
    expect(page.status).toBe(200);
    expect(fetchForecast).not.toHaveBeenCalled();

    // Two rounds started together are one: each day asked for once, never
    // two requests at the same time.
    await Promise.all([refreshToursWeather(), refreshToursWeather()]);
    expect(fetchForecast).toHaveBeenCalledTimes(3);
    expect(most).toBe(1);
    // The next round, within 12 hours: nothing asked again.
    await refreshToursWeather();
    expect(fetchForecast).toHaveBeenCalledTimes(3);
    // The pages read what it saved.
    const again = await request(app).get(`/tours/${soon._id}`).set(asUser(member));
    expect(again.body.data.tour.dailyWeather).toHaveLength(3);
  });

  it('keeps the forecast on the day itself, freezes it the day after, asks nothing beyond 15 days', async () => {
    vi.mocked(fetchForecast).mockClear().mockResolvedValue({
      condition: 'clear',
      tempDayC: 25,
      tempNightC: 12,
    });
    vi.mocked(fetchHistorical).mockClear().mockResolvedValue({
      condition: 'rain',
      tempDayC: 15,
      tempNightC: 8,
    });
    const midnight = (daysFromToday) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + daysFromToday);
      return d;
    };
    // Yesterday + today.
    const running = await createTour({ startDate: midnight(-1), duration: 2 });
    // The 15th and the 16th day ahead.
    const far = await createTour({ startDate: midnight(15), duration: 2 });
    await refreshToursWeather();
    await refreshToursWeather();

    const byDay = (tour) => [...tour.dailyWeather].sort((a, b) => a.day - b.day);
    const savedRunning = byDay(await Tour.findById(running._id));
    expect(savedRunning).toHaveLength(2);
    expect(savedRunning[0]).toMatchObject({ day: 1, condition: 'rain', isFinal: true });
    expect(savedRunning[1]).toMatchObject({ day: 2, condition: 'clear', isFinal: false });
    expect(fetchHistorical).toHaveBeenCalledTimes(1);

    const savedFar = byDay(await Tour.findById(far._id));
    expect(savedFar).toHaveLength(1);
    expect(savedFar[0]).toMatchObject({ day: 1, isFinal: false });
  });

  describe('the weather outlook', () => {
    const midnight = (daysFromToday) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + daysFromToday);
      return d;
    };
    const sunny = { condition: 'clear', tempDayC: 21, tempNightC: 13, windSpeedKmh: 8 };

    beforeEach(() => {
      vi.mocked(fetchForecast)
        .mockClear()
        .mockResolvedValue({ ...sunny, rainChance: 10 });
      vi.mocked(fetchHistorical)
        .mockClear()
        .mockResolvedValue({ ...sunny, condition: 'rain' });
    });

    it('appears once every day has a forecast - on the tour and in the list', async () => {
      const near = await createTour({ startDate: midnight(3), duration: 2 });
      // Its last day is still beyond the forecast.
      const far = await createTour({ startDate: midnight(14), duration: 3 });
      const member = await createMember();

      await refreshToursWeather();
      const list = await request(app).get('/tours').set(asUser(member));
      const listed = (id) => list.body.data.tours.find((t) => t._id === String(id));
      expect(listed(near._id).weatherOutlook).toMatchObject({
        tier: 'perfect',
        word: 'Koktélos',
        frozen: false,
      });
      expect(listed(far._id).weatherOutlook).toBeUndefined();
      expect((await Tour.findById(near._id)).dailyWeather[0].rainChance).toBe(10);

      await refreshToursWeather();

      const res = await request(app).get(`/tours/${near._id}`).set(asUser(member));
      expect(res.body.data.tour.weatherOutlook.pack.map((p) => p.icon)).toEqual(['tshirt']);
      expect(res.body.data.tour.weatherOutlook.days).toHaveLength(2);
      // Asked for by the round only - not by the list or the page.
      expect(fetchForecast).toHaveBeenCalledTimes(2 + 2);

      await refreshToursWeather();

      const farPage = await request(app).get(`/tours/${far._id}`).set(asUser(member));
      expect(farPage.body.data.tour.weatherOutlook).toBeUndefined();
    });

    it('follows the forecast until the start date', async () => {
      const tour = await createTour({ startDate: midnight(2), duration: 1 });
      const member = await createMember();
      await refreshToursWeather();
      expect((await Tour.findById(tour._id)).weatherOutlook.tier).toBe('perfect');

      // The next refresh brings a storm.
      await Tour.updateOne(
        { _id: tour._id },
        { $set: { 'dailyWeather.0.fetchedAt': new Date(0) } },
      );
      vi.mocked(fetchForecast).mockResolvedValue({
        condition: 'thunderstorm',
        tempDayC: 6,
        tempNightC: 1,
        windSpeedKmh: 50,
        rainChance: 100,
      });
      await refreshToursWeather();
      const res = await request(app).get(`/tours/${tour._id}`).set(asUser(member));
      expect(res.body.data.tour.weatherOutlook).toMatchObject({ tier: 'rough', frozen: false });
    });

    it('freezes on the start date and never changes again', async () => {
      const tour = await createTour({ startDate: midnight(1), duration: 2 });
      const member = await createMember();
      await refreshToursWeather();
      const promised = (await Tour.findById(tour._id)).weatherOutlook.toObject();
      expect(promised.frozen).toBe(false);

      // The tour is now in its second day: day 1 gets its recorded weather.
      await Tour.updateOne({ _id: tour._id }, { $set: { startDate: midnight(-1) } });
      await refreshToursWeather();
      const res = await request(app).get(`/tours/${tour._id}`).set(asUser(member));
      expect(res.body.data.tour.dailyWeather.find((w) => w.day === 1)).toMatchObject({
        condition: 'rain',
        isFinal: true,
      });
      expect(res.body.data.tour.weatherOutlook).toMatchObject({
        frozen: true,
        tier: promised.tier,
        headline: promised.headline,
        score: promised.score,
      });
      expect(res.body.data.tour.weatherOutlook.days[0].condition).toBe('clear');
    });

    it('is never made up for a tour that started without one', async () => {
      const tour = await createTour({ startDate: midnight(0), duration: 2 });
      const member = await createMember();
      await refreshToursWeather();
      const res = await request(app).get(`/tours/${tour._id}`).set(asUser(member));
      expect(res.body.data.tour.dailyWeather).toHaveLength(2);
      expect(res.body.data.tour.weatherOutlook).toBeUndefined();
    });

    it('goes when the tour moves to other days', async () => {
      const tour = await createTour({ startDate: midnight(1), duration: 1 });
      await refreshToursWeather();
      const saved = await Tour.findById(tour._id);
      expect(saved.weatherOutlook).toBeDefined();
      saved.startDate = midnight(40);
      await saved.save();
      expect((await Tour.findById(tour._id)).weatherOutlook).toBeUndefined();
    });
  });

  it('serves the last 3 tours, stats and the monthly plan to logged-in users', async () => {
    for (let i = 0; i < 4; i++) await createTour({ startDate: new Date(`2024-0${i + 1}-10`) });
    const member = await createMember();
    const last3 = await request(app).get('/tours/last-3').set(asUser(member));
    expect(last3.body.data.tours).toHaveLength(3);
    const stats = await request(app).get('/tours/tour-stats').set(asUser(member));
    expect(stats.status).toBe(200);
    expect(stats.body.data).toMatchObject({ totalTours: 4, upcomingTours: 0, running: null });
    // Everyone the club knows, once each - the users.
    expect(stats.body.data.totalPeople).toBe(await User.countDocuments());
    expect(stats.body.data.totalPeople).toBeGreaterThan(0);
    // Tours still ahead aren't counted yet - they're "coming soon".
    const nextYear = new Date().getFullYear() + 1;
    await createTour({ startDate: new Date(`${nextYear}-05-10`) });
    await createTour({ startDate: new Date(`${nextYear}-07-10`) });
    const later = await request(app).get('/tours/tour-stats').set(asUser(member));
    expect(later.body.data).toMatchObject({ totalTours: 4, upcomingTours: 2 });
    expect((await request(app).get('/tours/montly-plan/2024').set(asUser(member))).status).toBe(
      200,
    );
    expect((await request(app).get('/tours/tour-stats')).status).toBe(401);
  });

  it("lists one year's tours: a range on the start date (two operators on a field)", async () => {
    await createTour({ startDate: new Date('2023-12-30T10:00:00'), title: 'Előtte' });
    await createTour({ startDate: new Date('2024-05-10T10:00:00'), title: 'Tavasz' });
    await createTour({ startDate: new Date('2024-09-10T10:00:00'), title: 'Ősz' });
    await createTour({ startDate: new Date('2025-01-02T10:00:00'), title: 'Utána' });
    const res = await request(app)
      .get('/tours')
      .query({ 'startDate.gte': '2024-01-01T00:00:00', 'startDate.lt': '2025-01-01T00:00:00' })
      .set(asUser(await createMember()));
    expect(res.status).toBe(200);
    expect(res.body.data.tours.map((t) => t.title).sort()).toEqual(['Tavasz', 'Ősz'].sort());
  });

  it('lists the years that had a tour, each once, oldest first', async () => {
    await createTour({ startDate: new Date('2024-05-10') });
    await createTour({ startDate: new Date('2019-08-10') });
    await createTour({ startDate: new Date('2024-09-10') });
    const res = await request(app)
      .get('/tours/years')
      .set(asUser(await createMember()));
    expect(res.status).toBe(200);
    expect(res.body.data.years).toEqual([2019, 2024]);
    expect((await request(app).get('/tours/years')).status).toBe(401);
  });

  it("the stats' attendee ages: per tour and per year, a big tour weighing more", async () => {
    const born = (year) => createMember({ birthday: new Date(`${year}-01-01`) });
    const big = await createTour({ startDate: new Date('2020-05-10'), title: 'Nagy' });
    const small = await createTour({ startDate: new Date('2020-08-10'), title: 'Kicsi' });
    const later = await createTour({ startDate: new Date('2022-06-10'), title: 'Későbbi' });
    await createTour({ startDate: new Date('2021-06-10'), title: 'Üres' });
    // Ages on the first day: 30, 40, 50 on the big one; 60 on the small one
    // (and someone with no birthday on file, who doesn't count).
    await createReservation(big, [await born(1990), await born(1980), await born(1970)]);
    await createReservation(small, [await born(1960), await createMember()]);
    await createReservation(later, [await born(2000)]);

    const res = await request(app)
      .get('/tours/tour-stats')
      .set(asUser(await createMember()));
    const { tours, years } = res.body.data.attendeeAges;
    expect(tours.map((t) => [t.title, t.year, t.averageAge, t.count])).toEqual([
      ['Nagy', 2020, 40, 3],
      ['Kicsi', 2020, 60, 1],
      ['Későbbi', 2022, 22, 1],
    ]);
    // 2020: (30 + 40 + 50 + 60) / 4, not the two tours' (40 + 60) / 2.
    expect(years).toEqual([
      { year: 2020, averageAge: 45, count: 4, total: 5, minAge: 30, maxAge: 60 },
      { year: 2022, averageAge: 22, count: 1, total: 1, minAge: 22, maxAge: 22 },
    ]);
    // Known ages of everyone there, and the youngest and oldest of them.
    expect(tours.map((t) => [t.count, t.total, t.minAge, t.maxAge])).toEqual([
      [3, 3, 30, 50],
      [1, 2, 60, 60],
      [1, 1, 22, 22],
    ]);

    // A baby not yet one counts as 1, not 0; someone "born" after the
    // tour has no age at all.
    const family = await createTour({ startDate: new Date('2015-07-10'), title: 'Babás' });
    await createReservation(family, [
      await createMember({ birthday: new Date('2015-02-01') }),
      await createMember({ birthday: new Date('1985-02-01') }),
      await createMember({ birthday: new Date('2016-02-01') }),
    ]);
    const again = await request(app)
      .get('/tours/tour-stats')
      .set(asUser(await createMember()));
    expect(again.body.data.attendeeAges.years[0]).toEqual({
      year: 2015,
      averageAge: 15.5,
      count: 2,
      total: 3,
      minAge: 1,
      maxAge: 30,
    });
  });
  // The list's query (filter, sort, page): tours.test.js's "what the list
  // may be asked for".
});

describe('editing and deleting tours (admin)', () => {
  it('updates fields and refuses an order number another tour already uses', async () => {
    const admin = await createAdmin();
    const a = await createTour();
    const b = await createTour();
    const res = await request(app)
      .patch(`/tours/${a._id}`)
      .set(asUser(admin))
      .send({ title: 'Átnevezve' });
    expect(res.status).toBe(200);
    expect(res.body.data.tour.title).toBe('Átnevezve');
    const clash = await request(app)
      .patch(`/tours/${a._id}`)
      .set(asUser(admin))
      .send({ order: b.order });
    expect(clash.status).toBe(400);
    expect(
      (await request(app).patch('/tours/000000000000000000000000').set(asUser(admin)).send({}))
        .status,
    ).toBe(404);
  });

  it('marks everyone paid when the advance is set to exactly 0%', async () => {
    const admin = await createAdmin();
    const tour = await createTour({
      accommodationPricePerNight: 1000,
      advancePaymentPercentage: 20,
    });
    await createReservation(tour, [await createMember(), await createMember()]);
    await request(app)
      .patch(`/tours/${tour._id}`)
      .set(asUser(admin))
      .send({ advancePaymentPercentage: 0 });
    const r = await Reservation.findOne({ tour: tour._id });
    expect(r.attendees.every((a) => a.paid)).toBe(true);
  });

  it('refuses a duplicate order number when creating', async () => {
    const admin = await createAdmin();
    const existing = await createTour();
    const res = await request(app)
      .post('/tours')
      .set(asUser(admin))
      .send({ order: existing.order, title: 'x' });
    expect(res.status).toBe(400);
    expect(
      (await request(app).post('/tours').set(asUser(admin)).send({ title: 'no order' })).status,
    ).toBe(400);
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
    const created = await request(app).post(`/tours/${tour._id}/schedule`).set(asUser(admin)).send({
      day: 2,
      time: '17:00',
      description: 'Borkóstoló',
      isOptional: true,
      extraCost: 3000,
    });
    return { admin, tour, event: created.body.data.event, status: created.status };
  }

  it('admin deletes an event, nobody else', async () => {
    const { admin, tour, event } = await tourWithOptionalEvent();
    const member = await createMember();
    const path = `/tours/${tour._id}/schedule/${event._id}`;
    expect((await request(app).delete(path).set(asUser(member))).status).toBe(403);
    expect((await request(app).delete(path).set(asUser(admin))).status).toBe(204);
    expect((await tour.constructor.findById(tour._id)).schedule).toHaveLength(0);
    expect((await request(app).delete(path).set(asUser(admin))).status).toBe(404);
  });

  it('admin adds and edits events; incomplete events are refused', async () => {
    const { admin, tour, event, status } = await tourWithOptionalEvent();
    expect(status).toBe(201);
    expect(event).toMatchObject({ day: 2, isOptional: true, extraCost: 3000 });
    const bad = await request(app)
      .post(`/tours/${tour._id}/schedule`)
      .set(asUser(admin))
      .send({ day: 1 });
    expect(bad.status).toBe(400);
    const edited = await request(app)
      .patch(`/tours/${tour._id}/schedule/${event._id}`)
      .set(asUser(admin))
      .send({ time: '18:00', isOptional: false });
    expect(edited.body.data.event).toMatchObject({ time: '18:00', isOptional: false });
    expect(edited.body.data.event.extraCost).toBeUndefined();
    expect(
      (
        await request(app)
          .patch(`/tours/${tour._id}/schedule/000000000000000000000000`)
          .set(asUser(admin))
          .send({})
      ).status,
    ).toBe(404);
  });

  it('admin moves an event to another day; its time, price and opt-ins come along', async () => {
    const { admin, tour, event } = await tourWithOptionalEvent();
    const url = `/tours/${tour._id}/schedule/${event._id}`;
    const optedIn = await request(app)
      .patch(`${url}/participants`)
      .set(asUser(admin))
      .send({ userIds: [] });
    expect(optedIn.status).toBe(200);

    const moved = await request(app).patch(url).set(asUser(admin)).send({ day: 3 });
    expect(moved.status).toBe(200);
    expect(moved.body.data.event).toMatchObject({
      day: 3,
      time: '17:00',
      description: 'Borkóstoló',
      isOptional: true,
      extraCost: 3000,
    });

    // Only one of the tour's own days (the test tour has 3).
    for (const day of [0, 4, 1.5, '2']) {
      const bad = await request(app).patch(url).set(asUser(admin)).send({ day });
      expect(bad.status, String(day)).toBe(400);
    }
    const member = await createMember();
    expect((await request(app).patch(url).set(asUser(member)).send({ day: 1 })).status).toBe(403);
  });

  it('a member signs up themselves and family, not strangers', async () => {
    const { tour, event } = await tourWithOptionalEvent();
    const member = await createMember();
    const kid = await createMember({ familyId: member.familyId });
    const stranger = await createGuest();
    await createReservation(tour, [member, kid]);
    await createReservation(tour, [stranger]);
    const url = `/tours/${tour._id}/schedule/${event._id}/participants`;
    const ok = await request(app)
      .patch(url)
      .set(asUser(member))
      .send({ userIds: [String(member._id), String(kid._id)] });
    expect(ok.status).toBe(200);
    expect(ok.body.data.participants).toHaveLength(2);
    const no = await request(app)
      .patch(url)
      .set(asUser(member))
      .send({ userIds: [String(stranger._id)] });
    expect(no.status).toBe(403);
    expect((await request(app).patch(url).set(asUser(member)).send({ userIds: 'x' })).status).toBe(
      400,
    );
    // The stranger's own sign-up leaves the family's in place.
    await request(app)
      .patch(url)
      .set(asUser(stranger))
      .send({ userIds: [String(stranger._id)] });
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
