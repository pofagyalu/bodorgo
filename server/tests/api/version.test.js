import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createGuest } from '../helpers/factories.js';

describe('GET /health/version', () => {
  it('tells anyone logged in which version is running: date and commit', async () => {
    const res = await request(app)
      .get('/health/version')
      .set(asUser(await createGuest()));
    expect(res.status).toBe(200);
    // Run from the source (as here), it's read from git and has no build
    // time. Where git can't be asked (some CI containers), it says so
    // instead of failing.
    const { version, commit, date, builtAt } = res.body.data;
    expect(builtAt).toBeNull();
    if (commit === null) {
      expect(version).toBe('ismeretlen');
    } else {
      expect(commit).toMatch(/^[0-9a-f]{7}$/);
      expect(date).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
      expect(version).toContain(`${date} · ${commit}`);
    }
  });

  it('is not for visitors', async () => {
    expect((await request(app).get('/health/version')).status).toBe(401);
  });
});
