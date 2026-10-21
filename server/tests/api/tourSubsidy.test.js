import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createTour } from '../helpers/factories.js';
import Transaction from '../../src/models/transactionModel.js';
import { tourLastDay } from '../../src/utils/tourSubsidy.js';

// Klub hozzájárulása: one Szállásköltség expense per tour in Pénzügyek,
// kept in step with the tour's own save.
const patch = (user, tour, body) =>
  request(app).patch(`/tours/${tour._id}`).set(asUser(user)).send(body);
const entriesOf = (tour) => Transaction.find({ tour: tour._id }).lean();

describe('Klub hozzájárulása in Pénzügyek', () => {
  it('a sum makes one expense on the last day; a new sum, title or date changes it', async () => {
    const admin = await createAdmin();
    const tour = await createTour({ startDate: new Date('2027-07-09T22:00:00Z'), duration: 4 });

    expect((await patch(admin, tour, { contact: 'Valaki' })).status).toBe(200);
    expect(await entriesOf(tour)).toEqual([]);

    await patch(admin, tour, { clubSubsidyAmount: 120000 });
    let [entry, ...more] = await entriesOf(tour);
    expect(more).toEqual([]);
    expect(entry).toMatchObject({
      type: 'expense',
      category: 'Szállásköltség',
      amount: 120000,
      currency: 'HUF',
      name: `${tour.title} - szállásköltség támogatás`,
    });
    // 10 July (Budapest) + 3 days.
    expect(entry.date.toISOString()).toBe('2027-07-13T00:00:00.000Z');
    expect(String(entry.createdBy)).toBe(String(admin._id));

    await patch(admin, tour, {
      clubSubsidyAmount: 80000,
      title: 'Új név',
      startDate: '2027-08-01T08:00:00Z',
    });
    [entry, ...more] = await entriesOf(tour);
    expect(more).toEqual([]);
    expect(entry).toMatchObject({ amount: 80000, name: 'Új név - szállásköltség támogatás' });
    expect(entry.date.toISOString()).toBe('2027-08-04T00:00:00.000Z');
  });

  it('goes at 0, on an EUR tour, and with the tour', async () => {
    const admin = await createAdmin();
    const tour = await createTour();

    await patch(admin, tour, { clubSubsidyAmount: 50000 });
    expect(await entriesOf(tour)).toHaveLength(1);
    await patch(admin, tour, { clubSubsidyAmount: 0 });
    expect(await entriesOf(tour)).toEqual([]);

    await patch(admin, tour, { clubSubsidyAmount: 50000 });
    await patch(admin, tour, { accommodationCurrency: 'EUR', eurHufExchangeRate: 400 });
    expect(await entriesOf(tour)).toEqual([]);

    await patch(admin, tour, { accommodationCurrency: 'HUF' });
    expect(await entriesOf(tour)).toHaveLength(1);
    const del = await request(app).delete(`/tours/${tour._id}`).set(asUser(admin));
    expect(del.status).toBe(204);
    expect(await entriesOf(tour)).toEqual([]);
  });

  it('none for a tour before the club (2019)', async () => {
    const admin = await createAdmin();
    const tour = await createTour({ startDate: new Date('2018-06-01T00:00:00Z') });
    await patch(admin, tour, { clubSubsidyAmount: 50000 });
    expect(await entriesOf(tour)).toEqual([]);
  });

  it('a new tour with a sum gets it at once', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .post('/tours')
      .set(asUser(admin))
      .send({
        order: 4321,
        title: 'Friss tábor',
        summary: 'x',
        description: 'x',
        startDate: '2027-05-01T08:00:00Z',
        duration: 2,
        maxCapacity: 10,
        location: { description: 'Hely', address: 'Utca 1', coordinates: [19.04, 47.5] },
        clubSubsidyAmount: 30000,
      });
    expect(res.status).toBe(201);
    const [entry] = await Transaction.find({ tour: res.body.data.tour._id }).lean();
    expect(entry).toMatchObject({ amount: 30000, name: 'Friss tábor - szállásköltség támogatás' });
    expect(entry.date.toISOString()).toBe('2027-05-02T00:00:00.000Z');
  });

  it('the last day is the Budapest calendar day, across a clock change', () => {
    // Starts at local midnight on 25 Oct 2026 (22:00 UTC the day before);
    // the clocks go back that night.
    const tour = { startDate: new Date('2026-10-24T22:00:00Z'), duration: 3 };
    expect(tourLastDay(tour).toISOString()).toBe('2026-10-27T00:00:00.000Z');
  });
});
