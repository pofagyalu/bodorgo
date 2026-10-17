import mongoose from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember } from '../helpers/factories.js';
import AuditLog from '../../src/models/auditLogModel.js';
import { endAuthentikSessions, listAuthentikSessions } from '../../src/utils/authentikSessions.js';
import { deviceName } from '../../src/utils/deviceName.js';
import { isInternalAddress } from '../../src/utils/internalAddress.js';
import { endAppSessions, replaceSameDeviceSessions } from '../../src/utils/appSessions.js';

// Authentik's API replaced: the devices it remembers, as the helper gives them.
vi.mock('../../src/utils/authentikSessions.js', () => ({
  endAuthentikSessions: vi.fn(async () => 5),
  clearOlderAuthentikSessions: vi.fn(async () => 0),
  listAuthentikSessions: vi.fn(async () => [
    {
      id: '64113212-7d09-4f2d-98a4-a4e1a86317f7',
      device: 'Chrome · Android',
      ip: '130.43.212.91',
      lastUsedAt: '2026-10-15T16:08:04Z',
      expiresAt: '2027-01-13T16:08:03Z',
    },
  ]),
}));

const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; SM-S916B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36';
const BRAVE = '"Brave";v="141", "Not?A_Brand";v="8", "Chromium";v="141"';
const WINDOWS_FIREFOX =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0';

// A stored session as connect-mongo keeps it: the session as a JSON string.
async function storeSession(
  user,
  { userAgent, brands, daysLeft = 90, loginAt, ip = '192.168.1.33' } = {},
) {
  const _id = `sid-${Math.random()}`;
  await mongoose.connection.db.collection('sessions').insertOne({
    _id,
    expires: new Date(Date.now() + daysLeft * 24 * 60 * 60 * 1000),
    session: JSON.stringify({
      cookie: {},
      user: { id: String(user._id), email: user.email, userAgent, brands, ip, loginAt },
    }),
  });
  return _id;
}

beforeEach(() => {
  vi.mocked(listAuthentikSessions).mockClear();
  vi.mocked(endAuthentikSessions).mockClear();
});

describe('Profilom → Bejelentkezések (GET /auth/sessions)', () => {
  it('lists my own app sessions, newest first, and what Authentik remembers - not anyone else’s', async () => {
    const me = await createMember({ email: 'en@test.local' });
    const other = await createMember({ email: 'mas@test.local' });
    await storeSession(me, { userAgent: WINDOWS_FIREFOX, daysLeft: 80 });
    await storeSession(me, { userAgent: ANDROID, daysLeft: 90, loginAt: Date.now() });
    await storeSession(me, { daysLeft: 85 }); // from before devices were saved
    await storeSession(other, { userAgent: ANDROID });

    const res = await request(app).get('/auth/sessions').set(asUser(me)).set('User-Agent', ANDROID);
    expect(res.status).toBe(200);
    const { here, app: sessions, authentik, authentikError } = res.body.data;
    expect(here.device).toBe('Chrome · Android');
    expect(sessions.map((s) => s.device)).toEqual(['Chrome · Android', null, 'Firefox · Windows']);
    expect(sessions[0].loginAt).toBeTruthy();
    expect(sessions[2].loginAt).toBeNull();
    expect(authentik).toHaveLength(1);
    expect(authentikError).toBeNull();
    expect(listAuthentikSessions).toHaveBeenCalledWith('en@test.local');
  });

  it('leaves out logins from localhost and the Docker network - a home network counts', async () => {
    const me = await createMember();
    await storeSession(me, { userAgent: ANDROID, ip: '::1' });
    await storeSession(me, { userAgent: ANDROID, ip: '::ffff:172.22.0.1' });
    await storeSession(me, { userAgent: ANDROID, ip: '::ffff:192.168.1.33' });

    const res = await request(app).get('/auth/sessions').set(asUser(me));
    expect(res.body.data.app.map((s) => s.ip)).toEqual(['::ffff:192.168.1.33']);
  });

  it('a new login replaces the same browser’s old sessions, not another device’s', async () => {
    const me = await createMember();
    const sessions = mongoose.connection.db.collection('sessions');
    const oldSame = await storeSession(me, { userAgent: ANDROID });
    const otherDevice = await storeSession(me, { userAgent: WINDOWS_FIREFOX });
    const otherAddress = await storeSession(me, { userAgent: ANDROID, ip: '10.20.30.21' });
    const fresh = await storeSession(me, { userAgent: ANDROID });

    await replaceSameDeviceSessions(me._id, { userAgent: ANDROID, ip: '192.168.1.33' }, fresh);
    let left = (await sessions.find({}).toArray()).map((d) => d._id);
    expect(left).not.toContain(oldSame);
    expect(left).toEqual(expect.arrayContaining([otherDevice, otherAddress, fresh]));

    // Brave next to Chrome: the same User-Agent, only the brands differ.
    const brave = await storeSession(me, { userAgent: ANDROID, brands: BRAVE });
    await replaceSameDeviceSessions(
      me._id,
      { userAgent: ANDROID, brands: BRAVE, ip: '192.168.1.33' },
      brave,
    );
    left = (await sessions.find({}).toArray()).map((d) => d._id);
    expect(left).toEqual(expect.arrayContaining([fresh, brave]));
  });

  it('says so when Authentik cannot be asked, and still lists the app sessions', async () => {
    const me = await createMember();
    await storeSession(me, { userAgent: ANDROID });
    vi.mocked(listAuthentikSessions).mockRejectedValueOnce(new Error('Authentik 503'));

    const res = await request(app).get('/auth/sessions').set(asUser(me));
    expect(res.status).toBe(200);
    expect(res.body.data.app).toHaveLength(1);
    expect(res.body.data.authentik).toBeNull();
    expect(res.body.data.authentikError).toBe('Az Oridzsinátor most nem válaszol.');
  });

  it('only for the logged in', async () => {
    expect((await request(app).get('/auth/sessions')).status).toBe(401);
  });
});

describe('Kijelentkezés minden más eszközön (POST /auth/sessions/logout-others)', () => {
  it('ends every app session of mine but this one - also the unlisted ones - and all at Authentik', async () => {
    const me = await createMember({ email: 'en@test.local' });
    const other = await createMember();
    const sessions = mongoose.connection.db.collection('sessions');
    const here = await storeSession(me, { userAgent: ANDROID });
    await storeSession(me, { userAgent: WINDOWS_FIREFOX });
    await storeSession(me, { ip: '::1' });
    const theirs = await storeSession(other, { userAgent: ANDROID });

    expect(await endAppSessions(me._id, { except: here })).toBe(2);
    expect((await sessions.find({}).toArray()).map((d) => d._id).sort()).toEqual(
      [here, theirs].sort(),
    );
  });

  it('answers how many went; the app sessions go even when Authentik cannot be reached', async () => {
    const me = await createMember({ email: 'en@test.local' });
    await storeSession(me, { userAgent: ANDROID });

    let res = await request(app).post('/auth/sessions/logout-others').set(asUser(me));
    expect(res.status).toBe(200);
    // The test session has no id of its own: every stored one of mine went.
    expect(res.body.data).toEqual({ appEnded: 1, authentikEnded: 5 });
    expect(endAuthentikSessions).toHaveBeenCalledWith('en@test.local');

    await storeSession(me, { userAgent: ANDROID });
    vi.mocked(endAuthentikSessions).mockRejectedValueOnce(new Error('Authentik 503'));
    res = await request(app).post('/auth/sessions/logout-others').set(asUser(me));
    expect(res.body.data).toEqual({ appEnded: 1, authentikEnded: null });

    expect((await request(app).post('/auth/sessions/logout-others')).status).toBe(401);
  });
});

describe('Kijelentkeztetés mindenhonnan (POST /users/:id/logout-everywhere)', () => {
  it('the role manager ends all of their sessions - app and Authentik - and it goes into the Napló', async () => {
    const manager = await createAdmin({ canManageRoles: true, name: 'Gazda' });
    const lost = await createMember({ name: 'Elvesztett Telefon', email: 'tel@test.local' });
    const sessions = mongoose.connection.db.collection('sessions');
    await storeSession(lost, { userAgent: ANDROID });
    await storeSession(lost, { userAgent: WINDOWS_FIREFOX });
    const mine = await storeSession(manager, { userAgent: ANDROID });

    const res = await request(app)
      .post(`/users/${lost._id}/logout-everywhere`)
      .set(asUser(manager));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ appEnded: 2, authentikEnded: 5 });
    expect(endAuthentikSessions).toHaveBeenCalledWith('tel@test.local');
    expect((await sessions.find({}).toArray()).map((d) => d._id)).toEqual([mine]);
    const entry = await AuditLog.findOne({ action: 'logout-everywhere' });
    expect(entry.summary).toBe('Elvesztett Telefon kijelentkeztetve mindenhonnan');
    expect(String(entry.target)).toBe(String(lost._id));
  });

  it('the role manager sees where they are logged in - nobody else does', async () => {
    const manager = await createAdmin({ canManageRoles: true });
    const lost = await createMember({ email: 'tel@test.local' });
    await storeSession(lost, { userAgent: ANDROID, loginAt: Date.now() });
    const url = `/users/${lost._id}/sessions`;

    const res = await request(app).get(url).set(asUser(manager));
    expect(res.status).toBe(200);
    expect(res.body.data.app.map((s) => s.device)).toEqual(['Chrome · Android']);
    expect(res.body.data.authentik).toHaveLength(1);
    expect(listAuthentikSessions).toHaveBeenCalledWith('tel@test.local');
    expect(
      (
        await request(app)
          .get(url)
          .set(asUser(await createAdmin()))
      ).status,
    ).toBe(403);
    expect((await request(app).get(url).set(asUser(lost))).status).toBe(403);
  });

  it('only the role manager, only identified in the last ten minutes', async () => {
    const manager = await createAdmin({ canManageRoles: true });
    const lost = await createMember();
    const otherAdmin = await createAdmin();
    const url = `/users/${lost._id}/logout-everywhere`;

    expect((await request(app).post(url).set(asUser(otherAdmin))).status).toBe(403);
    expect((await request(app).post(url).set(asUser(lost))).status).toBe(403);
    const stale = await request(app)
      .post(url)
      .set(asUser(manager, { minutesAgo: 30 }));
    expect(stale.status).toBe(403);
    expect(stale.body.code).toBe('fresh-login-required');
    expect(endAuthentikSessions).not.toHaveBeenCalled();
    expect(
      (
        await request(app)
          .post(`/users/${new mongoose.Types.ObjectId()}/logout-everywhere`)
          .set(asUser(manager))
      ).status,
    ).toBe(404);
  });
});

describe('Felfüggesztés (DELETE /users/:id) logs them out', () => {
  it('every app session of theirs ends at once; nobody else’s', async () => {
    const admin = await createAdmin();
    const member = await createMember({ email: 'felfuggesztett@test.local' });
    const other = await createMember({ email: 'marad@test.local' });
    await storeSession(member, { userAgent: ANDROID });
    await storeSession(member, { userAgent: WINDOWS_FIREFOX });
    const kept = await storeSession(other, { userAgent: ANDROID });

    const res = await request(app).delete(`/users/${member._id}`).set(asUser(admin));
    expect(res.status).toBe(200);
    const left = await mongoose.connection.db.collection('sessions').find().toArray();
    expect(left.map((s) => s._id)).toEqual([kept]);
  });

  it('someone without an e-mail - just a name in a family - is simply suspended', async () => {
    const admin = await createAdmin();
    const child = await createMember({ email: undefined, name: 'Kis Gyerek' });
    const res = await request(app).delete(`/users/${child._id}`).set(asUser(admin));
    expect(res.status).toBe(200);
    expect(res.body.data.user.retired).toBe(true);
  });
});

describe('isInternalAddress', () => {
  it.each([
    ['::1', true],
    ['127.0.0.1', true],
    ['::ffff:127.0.0.1', true],
    ['::ffff:172.22.0.1', true],
    ['172.31.255.1', true],
    ['172.32.0.1', false],
    ['192.168.1.33', false],
    ['10.20.30.21', false],
    ['130.43.212.91', false],
    [null, false],
  ])('%s → %s', (ip, internal) => expect(isInternalAddress(ip)).toBe(internal));
});

describe('deviceName', () => {
  it('Brave and Edge by their brands, though their User-Agent is Chrome’s', () => {
    expect(deviceName(ANDROID, BRAVE)).toBe('Brave · Android');
    expect(deviceName(ANDROID, '"Microsoft Edge";v="141", "Chromium";v="141"')).toBe(
      'Edge · Android',
    );
    expect(deviceName(ANDROID, '"Google Chrome";v="141", "Chromium";v="141"')).toBe(
      'Chrome · Android',
    );
  });

  it.each([
    [ANDROID, 'Chrome · Android'],
    [WINDOWS_FIREFOX, 'Firefox · Windows'],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Safari · iPhone',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0 Mobile Safari/537.36',
      'Samsung Internet · Android',
    ],
    [
      'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
      'Firefox · Ubuntu',
    ],
    ['', null],
  ])('%s → %s', (ua, name) => expect(deviceName(ua)).toBe(name));
});
