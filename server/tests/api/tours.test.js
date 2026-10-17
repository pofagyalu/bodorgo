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

describe('tours: members-only access', () => {
  it('refuses the tour list when logged out', async () => {
    await createTour();
    const res = await request(app).get('/tours');
    expect(res.status).toBe(401);
  });

  it('lists tours for any logged-in user, guests included', async () => {
    await createTour({ title: 'Mátrai tábor' });
    const guest = await createGuest();
    const res = await request(app).get('/tours').set(asUser(guest));
    expect(res.status).toBe(200);
    expect(res.body.data.tours.map((t) => t.title)).toContain('Mátrai tábor');
  });

  it('refuses a single tour when logged out, shows it when logged in', async () => {
    const tour = await createTour();
    const member = await createMember();
    expect((await request(app).get(`/tours/${tour._id}`)).status).toBe(401);
    const res = await request(app).get(`/tours/${tour.slug}`).set(asUser(member));
    expect(res.status).toBe(200);
    expect(res.body.data.tour.title).toBe(tour.title);
  });

  it('does not serve the old public files any more', async () => {
    const res = await request(app).get('/img/tours/tour-1-cover.jpg');
    expect(res.status).toBe(404);
  });
});

// Every logged-in user reads the tours, guests too: who is on them, but not
// the birthdays (age is the admins' only), roles, families or the booker's
// e-mail that the prices are worked out from.
describe('tours: what everyone sees of the attendees', () => {
  it('the list sends no reservations at all; one tour only who is on it', async () => {
    const tour = await createTour({ title: 'Mátrai tábor' });
    const booker = await createMember({ name: 'Foglaló Tag', birthday: new Date('1980-03-04') });
    const child = await createMember({ name: 'Kis Gyerek', birthday: new Date('2018-06-07') });
    const reservation = await createReservation(tour, [booker, child]);
    const guest = await createGuest();

    const list = await request(app).get('/tours').set(asUser(guest));
    const listed = list.body.data.tours.find((t) => t.title === 'Mátrai tábor');
    expect(listed.participantCount).toBe(2);
    expect(listed.reservations).toBeUndefined();

    const res = await request(app).get(`/tours/${tour.slug}`).set(asUser(guest));
    expect(res.status).toBe(200);
    const sent = JSON.stringify(res.body);
    expect(sent).not.toContain('birthday');
    expect(sent).not.toContain('1980-03-04');
    expect(sent).not.toContain(booker.email);
    const [shown] = res.body.data.tour.reservations;
    expect(shown._id).toBe(String(reservation._id));
    expect(shown.bookedBy).toEqual({ _id: String(booker._id), name: 'Foglaló Tag' });
    expect(shown.attendees.map((a) => [a.user, a.name])).toEqual([
      [String(booker._id), 'Foglaló Tag'],
      [String(child._id), 'Kis Gyerek'],
    ]);
  });
});

// The address may only ask for what the app uses (utils/apiFeatures.js):
// a startDate range, a sort, a page - no hidden fields, no other operators.
describe('tours: what the list may be asked for', () => {
  const list = async (query) => {
    const res = await request(app)
      .get(`/tours${query}`)
      .set(asUser(await createMember()));
    expect(res.status).toBe(200);
    return res.body.data.tours;
  };

  it('hidden fields stay hidden, whatever the address says', async () => {
    await createTour({ sourceFolder: '/volume1/titkos/mappa' });
    const tours = await list('?fields=+sourceFolder,+reviews');
    expect(tours).toHaveLength(1);
    expect(JSON.stringify(tours)).not.toContain('titkos');
    expect(tours[0].title).toBeTruthy();
  });

  it('only a date range filters - any other operator or field is ignored', async () => {
    await createTour({ title: 'Idei', startDate: new Date('2025-07-01') });
    await createTour({ title: 'Tavalyi', startDate: new Date('2024-07-01') });
    expect(await list('?title.regex=(a%2B)%2B%24')).toHaveLength(2);
    expect(await list('?title=Idei&order.ne=1&maxCapacity.gt=5')).toHaveLength(2);
    const year = await list('?startDate.gte=2025-01-01T00:00:00&startDate.lt=2026-01-01T00:00:00');
    expect(year.map((t) => t.title)).toEqual(['Idei']);
    expect(await list('?startDate.gte=nem-datum')).toHaveLength(2);
  });

  it('sorts by order or start date only; the page size is capped', async () => {
    await createTour({ title: 'Első', order: 1, startDate: new Date('2025-08-01') });
    await createTour({ title: 'Második', order: 2, startDate: new Date('2025-06-01') });
    const titles = async (q) => (await list(q)).map((t) => t.title);
    expect(await titles('')).toEqual(['Második', 'Első']);
    expect(await titles('?sort=-startDate')).toEqual(['Első', 'Második']);
    // A hidden field to sort by, or the same key twice: the default.
    expect(await titles('?sort=sourceFolder')).toEqual(['Második', 'Első']);
    expect(await titles('?sort=order&sort=-order')).toEqual(['Második', 'Első']);
    expect(await titles('?limit=1&page=2')).toEqual(['Első']);
    expect(await titles('?limit=999999')).toHaveLength(2);
    expect(await titles('?limit=-5&page=x')).toHaveLength(2);
  });

  it('the last three are still the three newest', async () => {
    for (const order of [1, 2, 3, 4]) await createTour({ title: `T${order}`, order });
    const res = await request(app)
      .get('/tours/last-3')
      .set(asUser(await createMember()));
    expect(res.body.data.tours.map((t) => t.title)).toEqual(['T4', 'T3', 'T2']);
  });
});

describe('tours: public ticker', () => {
  it('works logged out and shows only the ticker fields of the next tour', async () => {
    await createTour({ title: 'Régi', startDate: new Date(Date.now() - 400 * 24 * 3600 * 1000) });
    await createTour({
      title: 'Következő',
      startDate: new Date(Date.now() + 10 * 24 * 3600 * 1000),
    });
    const res = await request(app).get('/tours/ticker');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      label: 'Következő',
      title: 'Következő',
      place: 'Teszt hely',
    });
    expect(Object.keys(res.body.data).sort()).toEqual([
      'label',
      'order',
      'place',
      'startDate',
      'title',
    ]);
  });

  it('falls back to the latest tour once every tour has ended', async () => {
    await createTour({ title: 'Régebbi', startDate: new Date('2020-05-01') });
    await createTour({ title: 'Legutóbbi', startDate: new Date('2024-05-01') });
    const res = await request(app).get('/tours/ticker');
    expect(res.body.data).toMatchObject({ label: 'Legutóbbi', title: 'Legutóbbi' });
  });

  it('returns null when there are no tours', async () => {
    const res = await request(app).get('/tours/ticker');
    expect(res.body.data).toBeNull();
  });
});

describe('tours: admin-only changes', () => {
  it('lets only an admin create a tour', async () => {
    const member = await createMember();
    const admin = await createAdmin();
    const body = {
      order: 77,
      title: 'Új tábor',
      summary: 's',
      description: 'd',
      startDate: new Date(Date.now() + 5e9).toISOString(),
      duration: 2,
      maxCapacity: 10,
      location: { description: 'Hely', coordinates: [19, 47] },
    };
    expect((await request(app).post('/tours').set(asUser(member)).send(body)).status).toBe(403);
    const res = await request(app).post('/tours').set(asUser(admin)).send(body);
    expect(res.status).toBe(201);
    expect(res.body.data.tour.title).toBe('Új tábor');
  });
});
