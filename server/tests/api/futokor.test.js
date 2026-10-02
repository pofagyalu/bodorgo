import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createGuest, createMember, createTour } from '../helpers/factories.js';
import {
  FutokorCourse,
  FutokorRun,
  FutokorScan,
  FutokorTag,
} from '../../src/models/futokorModels.js';
import GpxTrack from '../../src/models/gpxTrackModel.js';
import { tagToken, verifyTagToken } from '../../src/futokor/tags.js';
import User from '../../src/models/userModel.js';
import { ensureFutokodok } from '../../src/utils/futokod.js';

// Futókör over HTTP (the rules of a run: tests/unit/futokorRunRules.test.js).

// While it's being built only the role manager gets in (futokor/access.js).
const createOwner = () => createAdmin({ name: 'Nagy Zoli', canManageRoles: true });
// Someone else who is in (as everyone will be, once it opens).
const createRunner = (overrides = {}) => createMember({ canManageRoles: true, ...overrides });

const get = (user, url) => request(app).get(`/futokor${url}`).set(asUser(user));
const post = (user, url, body) => request(app).post(`/futokor${url}`).set(asUser(user)).send(body);
const patch = (user, url, body) =>
  request(app).patch(`/futokor${url}`).set(asUser(user)).send(body);

const HOUR = 3600 * 1000;
// A moment of the course's opening day, `sec` seconds after its start.
const T0 = Date.now() - 2 * HOUR;
const at = (sec) => new Date(T0 + sec * 1000).toISOString();

// A 900 m course open now: START/FINISH and two checkpoints 300 m apart.
async function openCourse(owner) {
  await post(owner, '/tags', { kind: 'startFinish' });
  await post(owner, '/tags', { count: 3 });
  const tour = await createTour();
  const made = await post(owner, '/courses', {
    tourId: String(tour._id),
    opensAt: new Date(T0 - HOUR),
    closesAt: new Date(T0 + 24 * HOUR),
  });
  expect(made.status, made.body.message).toBe(201);
  const id = made.body.data.course._id;
  const set = await patch(owner, `/courses/${id}`, {
    distanceM: 900,
    startTagId: 'S1',
    stops: [
      { tagId: 'T02', distanceAlongM: 300 },
      { tagId: 'T01', distanceAlongM: 600 },
    ],
  });
  expect(set.status, set.body.message).toBe(200);
  return set.body.data.course;
}

let scanCount = 0;
const scan = (tagId, sec, extra = {}) => ({
  clientScanId: `scan-${Date.now()}-${(scanCount += 1)}`,
  token: tagId ? tagToken(tagId) : undefined,
  deviceTime: at(sec),
  ...extra,
});
// A whole lap: START, the two checkpoints, FINISH - `lapSec` seconds.
const lap = (from, lapSec) => [
  scan('S1', from),
  scan('T02', from + lapSec / 3),
  scan('T01', from + (2 * lapSec) / 3),
  scan('S1', from + lapSec),
];
const send = (user, scans) => post(user, '/scans', { scans });

describe('Futókör: who gets in', () => {
  it('only the role manager, for now - and the cards and the tours’ courses are the admins’', async () => {
    expect((await request(app).get('/futokor/active')).status).toBe(401);
    for (const user of [await createAdmin(), await createMember(), await createGuest()]) {
      expect((await get(user, '/active')).status).toBe(403);
      expect((await get(user, '/tags')).status).toBe(403);
      expect((await send(user, [])).status).toBe(403);
    }
    const runner = await createRunner();
    expect((await get(runner, '/active')).status).toBe(200);
    expect((await get(runner, '/tags')).status).toBe(403);
    // A tour's course is the admins' to make.
    const tour = await createTour();
    expect((await post(runner, '/courses', { tourId: String(tour._id) })).status).toBe(403);
  });
});

describe('Futókör: the cards', () => {
  it('are numbered on, each with a signed link', async () => {
    const owner = await createOwner();
    const first = await post(owner, '/tags', { count: 2 });
    expect(first.status).toBe(201);
    expect(first.body.data.tags.map((t) => t.tagId)).toEqual(['T01', 'T02']);
    await post(owner, '/tags', { kind: 'startFinish' });
    const more = await post(owner, '/tags', { count: 1 });
    expect(more.body.data.tags[0].tagId).toBe('T03');

    const { tags } = (await get(owner, '/tags')).body.data;
    expect(tags.map((t) => [t.tagId, t.kind])).toEqual([
      ['T01', 'checkpoint'],
      ['T02', 'checkpoint'],
      ['T03', 'checkpoint'],
      ['S1', 'startFinish'],
    ]);
    const token = tags[0].url.split('/fk/')[1];
    expect(verifyTagToken(token)).toBe('T01');
    expect(verifyTagToken(`T01.${'x'.repeat(16)}`)).toBeNull();
    expect(verifyTagToken('T01')).toBeNull();
    expect(verifyTagToken(token.replace('T01', 'T02'))).toBeNull();

    expect((await post(owner, '/tags', { count: 0 })).status).toBe(400);
    expect((await post(owner, '/tags', { count: 31 })).status).toBe(400);
  });

  it('can be retired, and printed', async () => {
    const owner = await createOwner();
    expect((await get(owner, '/tags/sheet')).status).toBe(404);
    await post(owner, '/tags', { count: 2 });
    const retired = await patch(owner, '/tags/T02', { retired: true });
    expect(retired.body.data.tag).toMatchObject({ tagId: 'T02', retired: true });
    expect((await patch(owner, '/tags/T99', { retired: true })).status).toBe(404);

    const sheet = await get(owner, '/tags/sheet');
    expect(sheet.status).toBe(200);
    expect(sheet.headers['content-type']).toContain('application/pdf');
  });
});

describe('Futókör: a course', () => {
  it('is one per tour, never open at the same time as another', async () => {
    const owner = await createOwner();
    const course = await openCourse(owner);
    expect(course).toMatchObject({ distanceM: 900, name: expect.stringContaining('futókör') });
    expect(course.checkpoints.map((c) => [c.tagId, c.label, c.order, c.distanceAlongM])).toEqual([
      ['S1', 'RAJT / CÉL', 0, 0],
      ['T02', '1. pont', 1, 300],
      ['T01', '2. pont', 2, 600],
    ]);

    const window = { opensAt: new Date(T0), closesAt: new Date(T0 + HOUR) };
    const same = await post(owner, '/courses', { tourId: course.tour._id, ...window });
    expect(same.status).toBe(400);
    const other = await createTour();
    const overlap = await post(owner, '/courses', { tourId: String(other._id), ...window });
    expect(overlap.status).toBe(400);
    const later = await post(owner, '/courses', {
      tourId: String(other._id),
      opensAt: new Date(T0 + 48 * HOUR),
      closesAt: new Date(T0 + 72 * HOUR),
    });
    expect(later.status).toBe(201);
    expect((await get(owner, '/courses')).body.data.courses).toHaveLength(2);
  });

  it('carries its track and where its points are - saving it again keeps them', async () => {
    const owner = await createOwner();
    const course = await openCourse(owner);
    expect(course).toMatchObject({ track: [], elevationGainM: null });

    // As scripts/attachFutokorTrack.mjs leaves it.
    const stored = await FutokorCourse.findById(course._id);
    stored.track = [
      [47.0, 19.0],
      [47.001, 19.0],
    ];
    stored.elevationGainM = 12;
    stored.checkpoints[1].lat = 47.0005;
    stored.checkpoints[1].lng = 19.0;
    await stored.save();

    // The cards of the two points change places on Pályák.
    const saved = await patch(owner, `/courses/${course._id}`, {
      startTagId: 'S1',
      stops: [
        { tagId: 'T01', distanceAlongM: 300 },
        { tagId: 'T02', distanceAlongM: 600 },
      ],
    });
    expect(saved.body.data.course).toMatchObject({
      track: [
        [47, 19],
        [47.001, 19],
      ],
      elevationGainM: 12,
    });
    expect(saved.body.data.course.checkpoints[1]).toMatchObject({ tagId: 'T01', lat: 47.0005 });
    expect(saved.body.data.course.checkpoints[2].lat).toBeNull();
  });

  it('refuses cards and distances that make no sense', async () => {
    const owner = await createOwner();
    const course = await openCourse(owner);
    const set = (body) => patch(owner, `/courses/${course._id}`, body);
    const bad = [
      { startTagId: 'T01', stops: [] }, // not a START/FINISH card
      { startTagId: 'S1', stops: [{ tagId: 'T01' }, { tagId: 'T01' }] },
      { startTagId: 'S1', stops: [{ tagId: 'T99' }] },
      {
        startTagId: 'S1',
        stops: [
          { tagId: 'T01', distanceAlongM: 500 },
          { tagId: 'T02', distanceAlongM: 400 },
        ],
      },
      { distanceM: 500 }, // shorter than where the last checkpoint is
      { opensAt: new Date(T0), closesAt: new Date(T0 - HOUR) },
    ];
    for (const body of bad) expect((await set(body)).status, JSON.stringify(body)).toBe(400);
  });

  it('is what a phone gets to run it - the open one, or the next to open', async () => {
    const owner = await createOwner();
    expect((await get(owner, '/active')).body.data.course).toBeNull();
    const course = await openCourse(owner);
    const active = (await get(owner, '/active')).body.data;
    expect(active.course).toMatchObject({ _id: course._id, flagSpeedMps: 5.5 });
    expect(active.runs).toEqual([]);

    await patch(owner, `/courses/${course._id}`, {
      opensAt: new Date(Date.now() + HOUR),
      closesAt: new Date(Date.now() + 2 * HOUR),
    });
    expect((await get(owner, '/active')).body.data.course._id).toBe(course._id);
  });
});

describe('Futókör: running', () => {
  it('works a run out of the scans, however they arrive', async () => {
    const owner = await createOwner();
    await openCourse(owner);
    const scans = lap(0, 300);

    // The finish reaches the server first (by itself it looks like a
    // start), the start last.
    const first = await send(owner, [scans[3], scans[1]]);
    expect(first.body.data.results.map((r) => r.result)).toEqual(['started', 'noRun']);
    const rest = await send(owner, [scans[2], scans[0]]);
    expect(rest.status).toBe(200);
    expect(rest.body.data.runs[0].runs).toMatchObject([
      { status: 'finished', totalMs: 300000, passed: 2, paceSecPerKm: 333, flagged: false },
    ]);
    // Asked again, the same scans now say what they were.
    const again = await send(owner, scans);
    expect(again.body.data.results.map((r) => r.result)).toEqual([
      'started',
      'passed',
      'passed',
      'finished',
    ]);
    expect(await FutokorScan.countDocuments()).toBe(4);
    expect(await FutokorRun.countDocuments()).toBe(1);
  });

  it('refuses what is not a real scan', async () => {
    const owner = await createOwner();
    await openCourse(owner);
    await patch(owner, '/tags/T03', { retired: true });
    const res = await send(owner, [
      { clientScanId: 'a', token: 'T01.aaaaaaaaaaaaaaaa', deviceTime: at(0) },
      { clientScanId: 'b', token: tagToken('T03'), deviceTime: at(0) },
      { clientScanId: 'c', token: tagToken('S1'), deviceTime: 'yesterday' },
      { clientScanId: 'd', token: tagToken('S1'), deviceTime: new Date(Date.now() + HOUR) },
      // Before the course opened.
      { clientScanId: 'e', token: tagToken('S1'), deviceTime: new Date(T0 - 5 * HOUR) },
    ]);
    expect(res.body.data.results.map((r) => r.result)).toEqual([
      'unknownTag',
      'unknownTag',
      'invalid',
      'invalid',
      'noCourse',
    ]);
    expect(await FutokorScan.countDocuments()).toBe(0);
    expect((await send(owner, 'nothing')).status).toBe(400);
  });

  it('gives up, restarts - and keeps each runner’s scans their own', async () => {
    const owner = await createOwner();
    const anna = await createRunner({ name: 'Kiss Anna' });
    await openCourse(owner);

    const start = scan('S1', 0);
    await send(owner, [start, scan('T02', 100), scan('S1', 200, { action: 'restart' })]);
    const gaveUp = await send(owner, [scan(null, 250, { action: 'giveUp' })]);
    expect(gaveUp.body.data.results[0].result).toBe('gaveUp');
    expect(gaveUp.body.data.runs[0].runs.map((r) => r.status)).toEqual(['abandoned', 'gave_up']);

    // Someone else sending my scan's id gets nothing from it.
    const stolen = await send(anna, [start]);
    expect(stolen.body.data.results[0].result).toBe('invalid');
    expect(stolen.body.data.runs).toEqual([]);
  });

  it('ranks the runners by their best time', async () => {
    const owner = await createOwner();
    const anna = await createRunner({ name: 'Kiss Anna', username: 'anna' });
    const course = await openCourse(owner);
    await send(owner, [...lap(0, 300), ...lap(1000, 270)]);
    await send(anna, lap(100, 240));
    // 900 m in 150 s is 6 m/s: counted, but flagged.
    const bela = await createRunner({ name: 'Nagy Béla' });
    await send(bela, lap(200, 150));

    const board = await get(anna, `/courses/${course._id}/leaderboard`);
    expect(
      board.body.data.runners.map((r) => [r.name, r.totalMs, r.finishedRuns, r.flagged]),
    ).toEqual([
      ['Nagy Béla', 150000, 1, true],
      ['anna', 240000, 1, false],
      ['Nagy Zoli', 270000, 2, false],
    ]);
    expect((await get(anna, '/courses/nonsense/leaderboard')).status).toBe(404);
  });

  it('a deleted course takes its scans and runs with it - the cards stay', async () => {
    const owner = await createOwner();
    const course = await openCourse(owner);
    await send(owner, lap(0, 300));
    const gone = await request(app).delete(`/futokor/courses/${course._id}`).set(asUser(owner));
    expect(gone.status).toBe(204);
    expect(await FutokorScan.countDocuments()).toBe(0);
    expect(await FutokorRun.countDocuments()).toBe(0);
    expect((await get(owner, '/active')).body.data.course).toBeNull();
    expect((await get(owner, '/tags')).body.data.tags).toHaveLength(4);
    const again = await request(app).delete(`/futokor/courses/${course._id}`).set(asUser(owner));
    expect(again.status).toBe(404);
  });

  it('shows every futókör, and one’s results with each runner’s runs and splits', async () => {
    const owner = await createOwner();
    // Anna is 34 on the day; Béla has no birthday set.
    const anna = await createRunner({
      name: 'Kiss Anna',
      username: 'anna',
      gender: 'nő',
      birthday: new Date(Date.now() - 34.5 * 365.25 * 24 * HOUR),
    });
    const bela = await createRunner({ name: 'Nagy Béla', gender: 'férfi' });
    const course = await openCourse(owner);
    await send(owner, [...lap(0, 300), ...lap(1000, 270)]);
    await send(anna, lap(100, 240));
    // Béla starts, and never finishes - by now his time is up.
    await send(bela, [scan('S1', 50), scan('T02', 200)]);

    const list = (await get(anna, '/results')).body.data.courses;
    expect(list).toMatchObject([
      {
        _id: course._id,
        distanceM: 900,
        runners: 3,
        finishedRuns: 3,
        winner: { name: 'anna', totalMs: 240000 },
      },
    ]);

    const one = (await get(anna, `/courses/${course._id}/results`)).body.data;
    expect(one.course.checkpoints).toHaveLength(3);
    expect(one.runners.map((r) => [r.name, r.best?.totalMs ?? null, r.finishedRuns])).toEqual([
      ['anna', 240000, 1],
      ['Nagy Zoli', 270000, 2],
      ['Nagy Béla', null, 0],
    ]);
    // Who they are, to narrow the list by: the age group - never the age.
    expect(one.runners.map((r) => [r.gender, r.ageGroup])).toEqual([
      ['nő', '30-39'],
      [null, null],
      ['férfi', null],
    ]);
    expect(JSON.stringify(one)).not.toContain('birthday');
    // The latest run first; each with its splits.
    expect(one.runners[1].runs.map((r) => r.totalMs)).toEqual([270000, 300000]);
    expect(one.runners[0].runs[0].splits).toMatchObject([
      { toCheckpointId: 'T02', ms: 80000, distanceM: 300 },
      { toCheckpointId: 'T01', ms: 80000 },
      { toCheckpointId: 'S1', ms: 80000 },
    ]);
    expect(one.runners[2].runs[0]).toMatchObject({ status: 'expired', passed: 1 });
    expect((await get(anna, '/courses/nonsense/results')).status).toBe(404);
  });

  it('works the runs out again when the course changes', async () => {
    const owner = await createOwner();
    const course = await openCourse(owner);
    await send(owner, lap(0, 300));
    // The loop turns out to be 1800 m.
    await patch(owner, `/courses/${course._id}`, {
      distanceM: 1800,
      startTagId: 'S1',
      stops: [
        { tagId: 'T02', distanceAlongM: 600 },
        { tagId: 'T01', distanceAlongM: 1200 },
      ],
    });
    const { runs } = (await get(owner, '/active')).body.data;
    expect(runs).toMatchObject([{ status: 'finished', paceSecPerKm: 167, flagged: true }]);
  });
});

describe('Futókör: a user’s own track', () => {
  // A square of about 76 x 111 m around (47, 19): ~374 m.
  const SQUARE = `<?xml version="1.0"?><gpx><trk><name>Erdei kör</name><trkseg>
    <trkpt lat="47.0" lon="19.0"><ele>100</ele><time>2026-10-02T08:00:00Z</time></trkpt>
    <trkpt lat="47.0" lon="19.001"><ele>101</ele><time>2026-10-02T08:01:00Z</time></trkpt>
    <trkpt lat="47.001" lon="19.001"><ele>110</ele><time>2026-10-02T08:02:00Z</time></trkpt>
    <trkpt lat="47.001" lon="19.0"><ele>104</ele><time>2026-10-02T08:03:00Z</time></trkpt>
    <trkpt lat="47.0" lon="19.0"><ele>100</ele><time>2026-10-02T08:04:00Z</time></trkpt>
  </trkseg></trk></gpx>`;
  const upload = (user, id, gpx = SQUARE) =>
    request(app)
      .put(`/futokor/courses/${id}/track`)
      .set(asUser(user))
      .attach('gpx', Buffer.from(gpx), 'erdei-kor.gpx');
  const makeTrack = async (user, body = { name: 'Erdei kör', points: 2 }) =>
    (await post(user, '/courses', body)).body.data.course;

  it('is anyone’s to make - with its own cards, open from now', async () => {
    const anna = await createRunner({ name: 'Kiss Anna', username: 'anna' });
    const made = await post(anna, '/courses', { name: '  Erdei kör ', points: 2 });
    expect(made.status, made.body.message).toBe(201);
    const course = made.body.data.course;
    expect(course).toMatchObject({
      kind: 'own',
      tour: null,
      name: 'Erdei kör',
      owner: { name: 'anna' },
      canManage: true,
    });
    expect(course.checkpoints.map((c) => [c.tagId, c.label])).toEqual([
      ['P1-S', 'RAJT / CÉL'],
      ['P1-01', '1. pont'],
      ['P1-02', '2. pont'],
    ]);
    expect(course.cards.map((c) => c.tagId)).toEqual(['P1-01', 'P1-02', 'P1-S']);
    expect(course.cards[0].url).toContain('/fk/P1-01.');
    expect(Date.parse(course.closesAt) - Date.parse(course.opensAt)).toBeGreaterThan(
      300 * 24 * HOUR,
    );

    // The next one has its own cards; neither is among the club's.
    const second = await makeTrack(anna, { name: 'Tóparti kör', points: 1 });
    expect(second.checkpoints.map((c) => c.tagId)).toEqual(['P2-S', 'P2-01']);
    const owner = await createOwner();
    expect((await get(owner, '/tags')).body.data.tags).toEqual([]);

    for (const body of [{ points: 2 }, { name: 'x', points: 0 }, { name: 'x', points: 21 }]) {
      expect((await post(anna, '/courses', body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('is its maker’s (and the admins’) to change - nobody else’s', async () => {
    const owner = await createOwner();
    const anna = await createRunner({ name: 'Kiss Anna' });
    const bela = await createRunner({ name: 'Nagy Béla' });
    const course = await makeTrack(anna);

    expect((await patch(bela, `/courses/${course._id}`, { name: 'Az enyém' })).status).toBe(403);
    expect((await upload(bela, course._id)).status).toBe(403);
    const sheet = await get(bela, `/courses/${course._id}/sheet`);
    expect(sheet.status).toBe(403);
    const gone = await request(app).delete(`/futokor/courses/${course._id}`).set(asUser(bela));
    expect(gone.status).toBe(403);

    expect((await patch(anna, `/courses/${course._id}`, { name: 'Új név' })).status).toBe(200);
    expect((await patch(owner, `/courses/${course._id}`, { name: 'Admin név' })).status).toBe(200);
    // Each sees what they can change.
    expect((await get(anna, '/courses')).body.data.courses.map((c) => c.name)).toEqual([
      'Admin név',
    ]);
    expect((await get(bela, '/courses')).body.data.courses).toEqual([]);
    expect((await get(owner, '/courses')).body.data.courses).toHaveLength(1);

    const pdf = await get(anna, `/courses/${course._id}/sheet`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
  });

  it('gets more or fewer points - its cards follow', async () => {
    const anna = await createRunner();
    const course = await makeTrack(anna);
    const more = await patch(anna, `/courses/${course._id}`, { points: 3 });
    expect(more.body.data.course.checkpoints.map((c) => c.tagId)).toEqual([
      'P1-S',
      'P1-01',
      'P1-02',
      'P1-03',
    ]);
    const fewer = await patch(anna, `/courses/${course._id}`, { points: 1 });
    expect(fewer.body.data.course.cards.map((c) => c.tagId)).toEqual(['P1-01', 'P1-S']);
    expect(await FutokorTag.countDocuments({ course: course._id })).toBe(2);
  });

  it('takes its loop from a GPX file, and its points’ distances from where they are', async () => {
    const anna = await createRunner();
    const course = await makeTrack(anna);

    const up = await upload(anna, course._id);
    expect(up.status, up.body.message).toBe(200);
    expect(up.body.data.course).toMatchObject({ hasGpx: true, elevationGainM: 10 });
    expect(up.body.data.course.distanceM).toBeGreaterThan(370);
    expect(up.body.data.course.distanceM).toBeLessThan(378);
    expect(up.body.data.course.track).toHaveLength(5);
    // The START is where the loop begins.
    expect(up.body.data.course.checkpoints[0]).toMatchObject({ lat: 47, lng: 19 });

    // The file is kept, with what it measures.
    const record = await GpxTrack.findOne({ course: course._id });
    expect(record).toMatchObject({
      fileName: 'erdei-kor.gpx',
      name: 'Erdei kör',
      points: 5,
      durationSec: 240,
    });
    const file = await get(anna, `/courses/${course._id}/track.gpx`);
    expect(file.status).toBe(200);
    expect(file.headers['content-disposition']).toContain('erdei-kor.gpx');

    // The two points put on the map: the far corner, and the middle of the
    // way back.
    const placed = await patch(anna, `/courses/${course._id}`, {
      stops: [
        { lat: 47.001, lng: 19.001 },
        { lat: 47.0005, lng: 19.0 },
      ],
    });
    expect(placed.status, placed.body.message).toBe(200);
    const [, first, second] = placed.body.data.course.checkpoints;
    expect(first.distanceAlongM).toBeGreaterThan(183);
    expect(first.distanceAlongM).toBeLessThan(191);
    expect(second.distanceAlongM).toBeGreaterThan(313);
    expect(second.distanceAlongM).toBeLessThan(323);

    // In the wrong order they aren't on the loop one after the other.
    const wrong = await patch(anna, `/courses/${course._id}`, {
      stops: [
        { lat: 47.0005, lng: 19.0 },
        { lat: 47.001, lng: 19.001 },
      ],
    });
    expect(wrong.status).toBe(400);

    expect((await upload(anna, course._id, 'not a gpx')).status).toBe(400);
    // Taken off again: the points stay where they were.
    const off = await request(app).delete(`/futokor/courses/${course._id}/track`).set(asUser(anna));
    expect(off.body.data.course).toMatchObject({ hasGpx: false, track: [] });
    expect(off.body.data.course.checkpoints[1].lat).toBe(47.001);
    expect(await GpxTrack.countDocuments()).toBe(0);
    expect((await get(anna, `/courses/${course._id}/track.gpx`)).status).toBe(404);
  });

  it('is run beside a tour’s course - the phone says which course a scan is for', async () => {
    const owner = await createOwner();
    const anna = await createRunner({ name: 'Kiss Anna', username: 'anna' });
    const tourCourse = await openCourse(owner);
    // (Open since before the test's clock started.)
    const own = await makeTrack(anna, {
      name: 'Erdei kör',
      points: 1,
      opensAt: new Date(T0 - HOUR),
    });

    // Both are open: the tour's first.
    const active = (await get(anna, '/active')).body.data;
    expect(active.courses.map((c) => [c.kind, c.name])).toEqual([
      ['tour', tourCourse.name],
      ['own', 'Erdei kör'],
    ]);
    expect(active.course._id).toBe(tourCourse._id);
    expect(Object.keys(active.allRuns).sort()).toEqual([own._id, tourCourse._id].sort());

    // A lap on Anna's own track, by the owner of the site.
    const on = (courseId, list) => list.map((s) => ({ ...s, courseId }));
    const lapOwn = on(own._id, [scan('P1-S', 0), scan('P1-01', 60), scan('P1-S', 120)]);
    const sent = await send(owner, lapOwn);
    expect(sent.body.data.results.map((r) => r.result)).toEqual(['started', 'passed', 'finished']);
    // ...and one on the tour's course at the same time.
    await send(owner, on(tourCourse._id, lap(0, 300)));

    // A card of the other course isn't on this one.
    const stray = await send(owner, on(tourCourse._id, [scan('P1-01', 400)]));
    expect(stray.body.data.results[0].result).toBe('unknownTag');

    // Each course has its own results.
    const results = (await get(anna, '/results')).body.data.courses;
    expect(results.map((c) => [c.kind, c.finishedRuns, c.owner.name])).toEqual(
      expect.arrayContaining([
        ['own', 1, 'anna'],
        ['tour', 1, 'Nagy Zoli'],
      ]),
    );
    // An older phone, not naming the course: the card finds it.
    const old = await send(anna, [scan('P1-S', 500)]);
    expect(old.body.data.results[0].result).toBe('started');
    expect(String(old.body.data.runs[0].courseId)).toBe(own._id);
  });

  it('takes its cards, its runs and its file with it when deleted', async () => {
    const anna = await createRunner();
    const course = await makeTrack(anna, {
      name: 'Erdei kör',
      points: 2,
      opensAt: new Date(T0 - HOUR),
    });
    await upload(anna, course._id);
    await send(anna, [{ ...scan('P1-S', 0), courseId: course._id }]);
    expect(await FutokorScan.countDocuments()).toBe(1);

    const gone = await request(app).delete(`/futokor/courses/${course._id}`).set(asUser(anna));
    expect(gone.status).toBe(204);
    expect(await FutokorTag.countDocuments()).toBe(0);
    expect(await FutokorScan.countDocuments()).toBe(0);
    expect(await GpxTrack.countDocuments()).toBe(0);
  });
});

describe('Futókód', () => {
  const codeOf = async (user) => (await User.findById(user._id).select('+futokod')).futokod;

  it('everyone has their own - theirs and the admins’ to see, nobody else’s', async () => {
    const owner = await createOwner();
    const anna = await createGuest({ name: 'Kiss Anna' });
    const code = await codeOf(anna);
    expect(code).toMatch(/^[1-9]\d{3}$/);
    expect(code).not.toBe(await codeOf(owner));

    const me = await request(app).get('/users/me').set(asUser(anna));
    expect(me.body.data.futokod).toBe(code);
    const edit = await request(app).get(`/users/${anna._id}`).set(asUser(owner));
    expect(edit.body.data.user.futokod).toBe(code);
    // The members' list of everyone doesn't carry it.
    const all = await request(app)
      .get('/users')
      .set(asUser(await createMember()));
    expect(JSON.stringify(all.body)).not.toContain(code);
  });

  it('is given at the server start to whoever has none', async () => {
    const anna = await createGuest();
    await User.updateOne({ _id: anna._id }, { $unset: { futokod: 1 } });
    expect(await codeOf(anna)).toBeUndefined();
    await ensureFutokodok();
    expect(await codeOf(anna)).toMatch(/^\d{4}$/);
  });

  it('runs a course from a phone nobody is logged in on', async () => {
    const owner = await createOwner();
    // A child: no login, no part in what is still being built.
    const peti = await createGuest({ name: 'Kis Peti' });
    const code = await codeOf(peti);
    const course = await openCourse(owner);

    const bundle = await request(app).get('/futokor/course');
    expect(bundle.status).toBe(200);
    expect(bundle.body.data.course._id).toBe(course._id);
    const who = await request(app).post('/futokor/runner').send({ code });
    expect(who.body.data).toEqual({ name: 'Kis Peti' });
    expect((await request(app).post('/futokor/runner').send({ code: '0000' })).status).toBe(404);

    const sent = await request(app)
      .post('/futokor/scans')
      .send({ runnerCode: code, scans: lap(0, 300) });
    expect(sent.status).toBe(200);
    expect(sent.body.data.runs[0].runs).toMatchObject([{ status: 'finished', totalMs: 300000 }]);
    const board = await get(owner, `/courses/${course._id}/leaderboard`);
    expect(board.body.data.runners.map((r) => r.name)).toEqual(['Kis Peti']);

    // Without a code, and not logged in: nothing. A wrong code: nobody.
    expect((await request(app).post('/futokor/scans').send({ scans: [] })).status).toBe(401);
    const wrong = await request(app).post('/futokor/scans').send({ runnerCode: '0000', scans: [] });
    expect(wrong.status).toBe(404);
  });

  it('on a lent phone the code decides whose run it is, not who is logged in', async () => {
    const owner = await createOwner();
    const peti = await createGuest({ name: 'Kis Peti' });
    const course = await openCourse(owner);
    await post(owner, '/scans', { runnerCode: await codeOf(peti), scans: lap(0, 300) });
    const board = await get(owner, `/courses/${course._id}/leaderboard`);
    expect(board.body.data.runners.map((r) => r.name)).toEqual(['Kis Peti']);
    expect((await get(owner, '/active')).body.data).toMatchObject({
      runs: [],
      runner: { name: 'Nagy Zoli' },
    });
  });
});
