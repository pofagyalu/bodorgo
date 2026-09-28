import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createMember, createReservation, createTour } from '../helpers/factories.js';
import config from '../../src/config.js';

// The live server runs with NODE_ENV=production: errors must still carry
// their own (Hungarian) message to the user, and never a stack trace.
describe('error responses in production mode', () => {
  beforeEach(() => {
    config.nodeEnv = 'production';
  });
  afterEach(() => {
    config.nodeEnv = 'test';
  });

  it("an expected error keeps its message, and there's no stack trace", async () => {
    const tour = await createTour({ maxCapacity: 1 });
    await createReservation(tour, [await createMember()]);
    const res = await request(app)
      .post(`/tours/${tour._id}/signup`)
      .set(asUser(await createMember()))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ status: 'fail', message: 'Ez a tábor sajnos megtelt.' });
  });

  it('a malformed id gets a short message, not the database internals', async () => {
    const res = await request(app)
      .get('/tours/not-an-id/images')
      .set(asUser(await createMember()));
    expect(res.status).toBe(400);
    expect(res.body.message).toBeTruthy();
    expect(res.body.stack).toBeUndefined();
    expect(res.body.error).toBeUndefined();
  });
});
