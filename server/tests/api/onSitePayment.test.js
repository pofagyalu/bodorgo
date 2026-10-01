import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember, createTour } from '../helpers/factories.js';
import { onSitePaymentText } from '../../src/utils/onSitePayment.js';

// Fizetési módok - set with the rest of the tour (the tour edit form).
const patch = (user, tour, onSitePayment) =>
  request(app).patch(`/tours/${tour._id}`).set(asUser(user)).send({ onSitePayment });

describe('Fizetési módok (on-site payment)', () => {
  it('saved cleaned with the tour; everyone reads it with the tour', async () => {
    const admin = await createAdmin();
    const member = await createMember();
    const tour = await createTour();

    const saved = await patch(admin, tour, { cash: true, card: 'yes', szep: true, note: 'x' });
    expect(saved.status).toBe(200);
    expect(saved.body.data.tour.onSitePayment).toEqual({ cash: true, card: false, szep: true });

    const read = await request(app).get(`/tours/${tour._id}`).set(asUser(member));
    expect(read.body.data.tour.onSitePayment).toEqual({ cash: true, card: false, szep: true });
  });

  it('says it in one line for the Programfüzet', () => {
    expect(onSitePaymentText(null)).toBeNull();
    expect(onSitePaymentText({ cash: false, card: false, szep: false })).toBeNull();
    expect(onSitePaymentText({ cash: true, card: true, szep: true })).toBe(
      'készpénz, bankkártya, SZÉP kártya',
    );
    expect(onSitePaymentText({ szep: true })).toBe('SZÉP kártya');
  });
});

describe('Programfüzet with Fizetési módok', () => {
  it('renders, with the "**" footnote', async () => {
    const admin = await createAdmin();
    const tour = await createTour();
    await patch(admin, tour, { cash: true, szep: true });
    const res = await request(app)
      .get(`/tours/${tour._id}/pdf`)
      .set(asUser(admin))
      .buffer(true)
      .parse((r, done) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
    // To look at it: SAVE_PDF=<file> npx vitest run tests/api/onSitePayment.test.js
    if (process.env.SAVE_PDF) (await import('fs')).writeFileSync(process.env.SAVE_PDF, res.body);
  });
});
