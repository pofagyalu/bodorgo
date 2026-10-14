import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin } from '../helpers/factories.js';

// Two days long ago (no real log file has these dates), written into the
// logs folder the server reads, and removed afterwards.
const LOG_DIR = path.resolve('logs');
const APP_FILE = 'app-2001-01-02.log';
const ERROR_FILE = 'error-2001-01-01.log.gz';
const appLines = Array.from({ length: 12 }, (_, i) => `[2001-01-02 10:00:${i}] info: line ${i}`);

beforeAll(() => {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(path.join(LOG_DIR, APP_FILE), `${appLines.join('\n')}\n`);
  fs.writeFileSync(
    path.join(LOG_DIR, ERROR_FILE),
    zlib.gzipSync('[2001-01-01 09:00:00] error: 500 - boom\n'),
  );
});

afterAll(() => {
  for (const name of [APP_FILE, ERROR_FILE]) fs.rmSync(path.join(LOG_DIR, name), { force: true });
});

const owner = () => createAdmin({ canManageRoles: true });
const get = (user, url, opts) => request(app).get(`/settings${url}`).set(asUser(user, opts));

describe('Naplófájlok - the role manager only, after re-identifying', () => {
  it('lists the log files, newest day first', async () => {
    const res = await get(await owner(), '/logs');
    expect(res.status).toBe(200);
    const ours = res.body.data.files.filter((f) => f.date.startsWith('2001'));
    expect(ours).toEqual([
      { name: APP_FILE, kind: 'app', date: '2001-01-02', gz: false, size: expect.any(Number) },
      { name: ERROR_FILE, kind: 'error', date: '2001-01-01', gz: true, size: expect.any(Number) },
    ]);
  });

  it("gives a file's last lines, and unpacks a gzipped day", async () => {
    const user = await owner();
    const last = await get(user, `/logs/${APP_FILE}?lines=3`);
    expect(last.body.data).toEqual({
      name: APP_FILE,
      totalLines: 12,
      lines: appLines.slice(-3),
    });
    const gz = await get(user, `/logs/${ERROR_FILE}`);
    expect(gz.body.data.lines).toEqual(['[2001-01-01 09:00:00] error: 500 - boom']);
  });

  it('downloads a file as it is', async () => {
    const res = await get(await owner(), `/logs/${APP_FILE}/download`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain(APP_FILE);
    expect(res.text).toContain('line 11');
  });

  it('gives nothing but the log files', async () => {
    const user = await owner();
    for (const name of ['..%2F.env', 'server.js', 'app-2001-01-03.log', '.error-mail.json']) {
      expect((await get(user, `/logs/${name}`)).status).toBe(404);
    }
  });

  it('refuses another admin, and asks the role manager to identify again after 10 minutes', async () => {
    expect((await get(await createAdmin(), '/logs')).status).toBe(403);
    const stale = await get(await owner(), '/logs', { minutesAgo: 11 });
    expect(stale.status).toBe(403);
    expect(stale.body.code).toBe('fresh-login-required');
  });
});
