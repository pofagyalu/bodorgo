import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearOlderAuthentikSessions,
  endAuthentikSessions,
  listAuthentikSessions,
} from '../../src/utils/authentikSessions.js';

vi.mock('../../src/utils/oidcSettings.js', () => ({
  getOidcSettings: vi.fn(async () => ({ serverUrl: 'https://auth.test', apiToken: 'tok' })),
}));

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const PHONE =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36';
const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

const session = (uuid, ua, ip, lastUsed) => ({
  uuid,
  last_user_agent: ua,
  last_ip: ip,
  last_used: lastUsed,
  expires: '2027-01-13T19:58:40Z',
});

// A stand-in Authentik: one user, these sessions; DELETE takes one away.
let sessions;
let deleted;
beforeEach(() => {
  deleted = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options = {}) => {
      const u = new URL(url);
      const json = (body) => ({ ok: true, status: 200, json: async () => body });
      if (u.pathname === '/api/v3/core/users/') {
        return json({ results: [{ username: 'gazda', email: 'en@test.local' }] });
      }
      if (options.method === 'DELETE') {
        deleted.push(u.pathname.split('/').at(-2));
        return { ok: true, status: 204 };
      }
      return json({ results: sessions, pagination: { next: 0 } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('Authentik sessions', () => {
  it('one row per device and address, newest first, with how many records; no Docker or localhost', async () => {
    sessions = [
      session('a', CHROME, '192.168.1.33', minutesAgo(60)),
      session('b', CHROME, '192.168.1.33', minutesAgo(1)),
      session('c', PHONE, '130.43.212.91', minutesAgo(30)),
      session('d', CHROME, '::ffff:172.22.0.1', minutesAgo(5)),
      session('e', CHROME, '84.206.40.203', minutesAgo(600)),
    ];
    const rows = await listAuthentikSessions('en@test.local');
    expect(rows.map((r) => [r.id, r.device, r.count])).toEqual([
      ['b', 'Chrome · Windows', 2],
      ['c', 'Chrome · Android', 1],
      ['e', 'Chrome · Windows', 1],
    ]);
  });

  it('a login clears the same browser’s older records at that address, nothing else', async () => {
    sessions = [
      session('new', CHROME, '192.168.1.33', minutesAgo(1)),
      session('old1', CHROME, '192.168.1.33', minutesAgo(90)),
      session('old2', CHROME, '192.168.1.33', minutesAgo(9000)),
      session('elsewhere', CHROME, '84.206.40.203', minutesAgo(30)),
      session('phone', PHONE, '192.168.1.33', minutesAgo(20)),
    ];
    expect(await clearOlderAuthentikSessions('en@test.local', CHROME)).toBe(2);
    expect(deleted).toEqual(['old1', 'old2']);
  });

  it('clears nothing when this browser’s newest session was not just used', async () => {
    sessions = [
      session('x', CHROME, '192.168.1.33', minutesAgo(60)),
      session('y', CHROME, '192.168.1.33', minutesAgo(120)),
    ];
    expect(await clearOlderAuthentikSessions('en@test.local', CHROME)).toBe(0);
    expect(deleted).toEqual([]);
  });

  it('logging out everywhere ends every record - also Docker and localhost ones', async () => {
    sessions = [
      session('a', CHROME, '192.168.1.33', minutesAgo(1)),
      session('b', PHONE, '130.43.212.91', minutesAgo(30)),
      session('c', CHROME, '::ffff:172.22.0.1', minutesAgo(9000)),
    ];
    expect(await endAuthentikSessions('en@test.local')).toBe(3);
    expect(deleted).toEqual(['a', 'b', 'c']);
  });
});
