import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createMember } from '../helpers/factories.js';

// The server's request limit (app.js): 1000 in 15 minutes - per person,
// not per address. A family at home or a group on one hotel Wi-Fi share an
// address; one runaway phone used to shut them all out (2026-10-17).
describe('the request limit counts per person', () => {
  it('one person over it is stopped - not the others on the same address', async () => {
    const runaway = await createMember({ email: 'gyerek@test.local' });
    const parent = await createMember({ email: 'szulo@test.local' });

    for (let i = 0; i < 1000; i++) {
      expect((await request(app).get('/auth/me').set(asUser(runaway))).status).toBe(200);
    }
    const stopped = await request(app).get('/auth/me').set(asUser(runaway));
    expect(stopped.status).toBe(429);
    expect(stopped.body.message).toBe('Túl sok kérés - próbáld újra 15 perc múlva.');

    // Same address (the test's own), another account: still in.
    expect((await request(app).get('/auth/me').set(asUser(parent))).status).toBe(200);
    // And not logged in, from there: counted by the address - which the
    // runaway's requests didn't use up.
    expect((await request(app).get('/auth/me')).status).toBe(200);
  }, 60000);
});
