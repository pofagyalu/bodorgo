import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember, createReservation, createTour } from '../helpers/factories.js';
import Tour from '../../src/models/tourModel.js';

// "Előleg befizetve" (tour.advancePaidAt): set once from the tour edit form,
// never undone - from then on who paid keeps what they paid, everyone else
// pays it all on site, and no advance is paid any more.
async function pricedTour() {
  const tour = await createTour({
    title: 'Sarud',
    duration: 3,
    accommodationPricePerNight: 10000,
    advancePaymentPercentage: 30,
  });
  const paidMember = await createMember({ name: 'Fizető Tag' });
  const lateMember = await createMember({ name: 'Késő Tag' });
  const paidRes = await createReservation(tour, [paidMember]);
  const lateRes = await createReservation(tour, [lateMember]);
  return {
    tour,
    paidId: String(paidRes.attendees[0]._id),
    lateId: String(lateRes.attendees[0]._id),
  };
}

const cash = (admin, tour, attendeeIds) =>
  request(app).post('/payments/cash').set(asUser(admin)).send({ tourId: tour._id, attendeeIds });

const save = (admin, tour, body) =>
  request(app).patch(`/tours/${tour._id}`).set(asUser(admin)).send(body);

describe('Előleg befizetve', () => {
  it('dates itself once on save, and is never changed or cleared', async () => {
    const admin = await createAdmin();
    const { tour } = await pricedTour();

    // The date can't be sent in - only advancePaid: true sets it, to now.
    await save(admin, tour, { advancePaidAt: '2020-01-01' });
    expect((await Tour.findById(tour._id)).advancePaidAt).toBeUndefined();

    const before = Date.now();
    expect((await save(admin, tour, { advancePaid: true })).status).toBe(200);
    const { advancePaidAt } = await Tour.findById(tour._id);
    expect(advancePaidAt.getTime()).toBeGreaterThanOrEqual(before - 1000);

    // Saving again, or trying to clear or move it, leaves it as it was.
    await save(admin, tour, { advancePaid: true });
    await save(admin, tour, { advancePaid: false, advancePaidAt: null });
    expect((await Tour.findById(tour._id)).advancePaidAt).toEqual(advancePaidAt);
  });

  it('who paid keeps it, who did not pays it all on site - and no advance is paid after', async () => {
    const admin = await createAdmin();
    const { tour, paidId, lateId } = await pricedTour();
    // The house: 2 nights x 10 000 Ft, shared by the two: 10 000 Ft each,
    // 30%: 3 000 Ft advance.
    const paid = await cash(admin, tour, [paidId]);
    expect(paid.status).toBe(201);

    await save(admin, tour, { advancePaid: true });

    const read = await request(app).get(`/tours/${tour._id}`).set(asUser(admin));
    const rows = Object.fromEntries(read.body.data.attendeePayments.map((p) => [p.attendeeId, p]));
    expect(rows[paidId]).toMatchObject({ advance: 3000, rest: 7000, onSite: false });
    expect(rows[lateId]).toMatchObject({ advance: 0, rest: 10000, onSite: true });
    expect(read.body.data.paymentTotals).toMatchObject({ advance: 3000, rest: 17000 });

    // No new advance - in cash or online - and the paid one stays paid.
    const late = await cash(admin, tour, [lateId]);
    expect(late.status).toBe(400);
    expect(late.body.message).toMatch(/helyszínen/);
    const undo = await request(app)
      .delete(`/payments/${paid.body.data.payment._id}`)
      .set(asUser(admin));
    expect(undo.status).toBe(400);
  });
});
