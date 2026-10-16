import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import logger from '../../src/logger.js';
import { app, asUser } from '../helpers/app.js';
import { createMember } from '../helpers/factories.js';
import {
  BLOCK_MS,
  UNKNOWN_LIMIT,
  UNKNOWN_WINDOW_MS,
  isBlocked,
  noteUnknownAddress,
} from '../../src/utils/scannerBlock.js';

// Scanners asking for hundreds of addresses the server doesn't have are
// shut out for an hour; the app's own 404s and other visitors are not.

// From this address (app.js trusts one proxy: X-Forwarded-For is the visitor).
const from = (ip) => ({ 'X-Forwarded-For': ip });

describe('scanner block', () => {
  it('over the limit of unknown addresses: 429 for everything from that IP, others untouched', async () => {
    const scanner = '203.0.113.7';
    const errors = vi.spyOn(logger, 'error');
    for (let i = 0; i < UNKNOWN_LIMIT; i++) {
      const res = await request(app).get(`/.env-${i}`).set(from(scanner));
      expect(res.status).toBe(404);
    }
    expect((await request(app).get('/wp-admin').set(from(scanner))).status).toBe(404);
    // Now blocked - a real route too.
    const blocked = await request(app).get('/health').set(from(scanner));
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toBe('Túl sok kérés erről a címről.');
    await request(app).get('/.git/config').set(from(scanner));
    // Said once in the error log - as a 4xx line, so never e-mailed.
    const said = errors.mock.calls.map(([m]) => m).filter((m) => m.includes('Scanner blocked'));
    expect(said).toEqual([
      expect.stringMatching(/^429 - Scanner blocked for 60 min: 203.0.113.7 /),
    ]);

    // Somebody else is fine.
    expect((await request(app).get('/health').set(from('198.51.100.1'))).status).toBe(200);
  });

  it('the app’s own 404s never count', async () => {
    const member = await createMember();
    const ip = '198.51.100.2';
    for (let i = 0; i < UNKNOWN_LIMIT + 5; i++) {
      const res = await request(app)
        .get('/ocskapiac/0123456789abcdef01234567')
        .set({ ...asUser(member), ...from(ip) });
      expect(res.status).toBe(404);
    }
    expect((await request(app).get('/health').set(from(ip))).status).toBe(200);
  });

  it('counts within a minute only, and lets go after an hour', () => {
    const ip = '192.0.2.9';
    const t0 = 1_000_000;
    // Slowly - a new minute each time: never blocked.
    for (let i = 0; i < UNKNOWN_LIMIT * 2; i++) {
      noteUnknownAddress(ip, t0 + i * (UNKNOWN_WINDOW_MS + 1));
    }
    expect(isBlocked(ip, t0 + UNKNOWN_LIMIT * 2 * (UNKNOWN_WINDOW_MS + 1))).toBe(false);

    const t1 = t0 + 10 * 60 * 60 * 1000;
    for (let i = 0; i <= UNKNOWN_LIMIT; i++) noteUnknownAddress(ip, t1 + i);
    expect(isBlocked(ip, t1 + 1000)).toBe(true);
    expect(isBlocked(ip, t1 + BLOCK_MS + 1000)).toBe(false);
  });
});
