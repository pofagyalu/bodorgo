import fs from 'fs';
import request from 'supertest';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember, createReservation, createTour } from '../helpers/factories.js';
import Document from '../../src/models/documentModel.js';
import { fetchMapTile } from '../../src/utils/mapTiles.js';
import {
  ensureDocumentTracks,
  ensureTrackMap,
  outingName,
  tourHikeNumbers,
  tourHikes,
  trackMapPath,
  trackOf,
  trackStats,
} from '../../src/utils/documentTracks.js';
import { TRACK_MAP_HEIGHT, TRACK_MAP_WIDTH, renderTrackMap } from '../../src/utils/trackMap.js';

// A walk north of Mátraháza: a point every 100 s, ~55 m apart, climbing
// 5 m a step - recorded from 09:12 Budapest time on `day` (with times; `at`:
// another start, UTC) or planned (without). 48 minutes 20 seconds long.
const gpx = ({ day = '2026-07-11', times = true, heights = true, at = '07:12' } = {}) => {
  const start = Date.parse(`${day}T${at}:00Z`);
  const points = Array.from({ length: 30 }, (_, i) => {
    const ele = heights ? `<ele>${700 + i * 5}</ele>` : '';
    const time = times ? `<time>${new Date(start + i * 100000).toISOString()}</time>` : '';
    return `<trkpt lat="${47.87 + i * 0.0005}" lon="19.98">${ele}${time}</trkpt>`;
  });
  return `<?xml version="1.0"?><gpx version="1.1"><trk><name>Kékes</name><trkseg>${points.join('')}</trkseg></trk></gpx>`;
};

const upload = (user, tour, name, content) =>
  request(app)
    .post('/documents')
    .set(asUser(user))
    .field('name', name)
    .field('tour', String(tour._id))
    .attach('file', Buffer.from(content), {
      filename: 'activity.gpx',
      contentType: 'application/octet-stream',
    });

// A plain grey map tile in place of OpenStreetMap's.
async function fakeTiles() {
  const tile = await sharp({
    create: { width: 256, height: 256, channels: 3, background: '#cfd8dc' },
  })
    .png()
    .toBuffer();
  vi.mocked(fetchMapTile).mockResolvedValue(tile);
}

const binary = (req) =>
  req.buffer(true).parse((res, done) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => done(null, Buffer.concat(chunks)));
  });

describe("a tour's GPX tracks: a plan or the hike that happened", () => {
  it('reads what the track measures; a recording is the hike, a route without times a plan', () => {
    const walked = trackOf(gpx());
    expect(walked).toMatchObject({
      kind: 'recorded',
      elevationGainM: 145,
      elevationLossM: 0,
      durationSec: 2900,
    });
    expect(walked.startedAt.toISOString()).toBe('2026-07-11T07:12:00.000Z');
    expect(walked.distanceM).toBeGreaterThan(1500);
    expect(walked.distanceM).toBeLessThan(1700);

    expect(trackOf(gpx({ times: false }))).toMatchObject({
      kind: 'planned',
      startedAt: null,
      durationSec: null,
    });
    // No heights in the file: no climb to speak of.
    expect(trackOf(gpx({ heights: false }))).toMatchObject({
      elevationGainM: null,
      elevationLossM: null,
    });
    expect(trackOf('<gpx></gpx>')).toBeNull();

    // The beszámoló's numbers, in Budapest time - only what the file gives.
    expect(trackStats({ ...walked, distanceM: 12336, durationSec: 17556 })).toEqual([
      ['Indulás', '09:12'],
      ['Érkezés', '14:04'],
      ['Táv', '12,3 km'],
      ['Idő', '4 ó 53 p'],
      ['Emelkedő', '145 m'],
      ['Lejtő', '0 m'],
    ]);
    expect(trackStats(trackOf(gpx({ times: false, heights: false })))).toEqual([
      ['Táv', expect.stringMatching(/^1,\d km$/)],
    ]);
  });

  it('the upload keeps it on the document; the tour page gets it; the pencil switches the kind', async () => {
    const admin = await createAdmin();
    const member = await createMember();
    const tour = await createTour();
    const walked = (await upload(admin, tour, 'Kékes', gpx())).body.data.document;
    const plan = (await upload(admin, tour, 'Terv', gpx({ times: false }))).body.data.document;
    expect(walked.track).toMatchObject({ kind: 'recorded', durationSec: 2900 });
    expect(plan.track).toMatchObject({ kind: 'planned', startedAt: null });

    const page = (await request(app).get(`/tours/${tour._id}`).set(asUser(member))).body.data.tour;
    expect(page.extraDocuments.map((d) => d.track.kind)).toEqual(['recorded', 'planned']);

    const patch = (id, body, user = admin) =>
      request(app).patch(`/documents/${id}`).set(asUser(user)).send(body);
    const switched = await patch(plan._id, { trackKind: 'recorded' });
    expect(switched.status).toBe(200);
    expect(switched.body.data.document).toMatchObject({
      name: 'Terv',
      track: { kind: 'recorded' },
    });
    // Name and kind together; a kind that isn't one; a document that is no track.
    const both = await patch(plan._id, { name: 'Séta', trackKind: 'planned' });
    expect(both.body.data.document).toMatchObject({ name: 'Séta', track: { kind: 'planned' } });
    expect((await patch(plan._id, { trackKind: 'álom' })).status).toBe(400);
    const pdf = await request(app)
      .post('/documents')
      .set(asUser(admin))
      .field('name', 'Térkép')
      .field('tour', String(tour._id))
      .attach('file', Buffer.from('%PDF-1.4'), {
        filename: 'x.pdf',
        contentType: 'application/pdf',
      });
    expect(pdf.body.data.document.track).toBeNull();
    expect((await patch(pdf.body.data.document._id, { trackKind: 'recorded' })).status).toBe(400);
    expect((await patch(plan._id, { trackKind: 'recorded' }, member)).status).toBe(403);
  });

  it('a GPX from before tracks were read gets its record at the next start', async () => {
    const admin = await createAdmin();
    const tour = await createTour();
    const doc = (await upload(admin, tour, 'Régi', gpx())).body.data.document;
    await Document.updateOne({ _id: doc._id }, { $unset: { track: 1 } });
    await ensureDocumentTracks();
    expect((await Document.findById(doc._id)).track).toMatchObject({ kind: 'recorded' });
  });
});

describe("a hike's map and its place in the beszámoló", () => {
  it('draws the track on the map tiles - one picture, made once, gone with the document', async () => {
    await fakeTiles();
    const points = [
      { lat: 47.87, lng: 19.98 },
      { lat: 47.88, lng: 19.99 },
      { lat: 47.875, lng: 20.0 },
    ];
    const meta = await sharp(await renderTrackMap(points)).metadata();
    expect(meta).toMatchObject({
      format: 'jpeg',
      width: TRACK_MAP_WIDTH,
      height: TRACK_MAP_HEIGHT,
    });
    await expect(renderTrackMap(points.slice(0, 1))).rejects.toThrow();

    const admin = await createAdmin();
    const tour = await createTour();
    const uploaded = (await upload(admin, tour, 'Kékes', gpx())).body.data.document;
    const document = await Document.findById(uploaded._id);
    const file = await ensureTrackMap(document);
    expect(file).toBe(trackMapPath(document));
    expect(fs.existsSync(file)).toBe(true);
    // There already: no tiles asked for again.
    vi.mocked(fetchMapTile).mockClear();
    await ensureTrackMap(document);
    expect(fetchMapTile).not.toHaveBeenCalled();

    await request(app).delete(`/documents/${uploaded._id}`).set(asUser(admin));
    await new Promise((r) => setTimeout(r, 50));
    expect(fs.existsSync(file)).toBe(false);
  });

  it('only the walked tracks are hikes, each on its day - with the map, or without when it cannot be made', async () => {
    vi.mocked(fetchMapTile).mockRejectedValue(new Error('no map tiles'));
    const admin = await createAdmin();
    const anna = await createMember();
    // 10-12 July 2026, Budapest time.
    const tour = await createTour({ duration: 3, startDate: new Date('2026-07-09T22:00:00Z') });
    await createReservation(tour, [anna]);
    await upload(admin, tour, 'Vasárnapi séta', gpx({ day: '2026-07-12' }));
    await upload(admin, tour, 'Kékes', gpx({ day: '2026-07-11' }));
    await upload(admin, tour, 'Terv', gpx({ times: false }));
    await new Promise((r) => setTimeout(r, 50)); // the uploads' own tries at the map

    // No map tiles to be had: the hikes are there all the same.
    const without = await tourHikes(tour);
    expect(without.map((h) => [h.name, h.day, h.map])).toEqual([
      ['Kékes', 1, null],
      ['Vasárnapi séta', 2, null],
    ]);
    expect(without[0].stats[0]).toEqual(['Indulás', '09:12']);

    await fakeTiles();
    const hikes = await tourHikes(tour);
    expect(hikes.every((h) => fs.existsSync(h.map))).toBe(true);

    // The beszámoló carries them - also on a day nothing was written about.
    await request(app)
      .put(`/tours/${tour._id}/report`)
      .set(asUser(admin))
      .send({ days: [{ ops: [{ insert: 'Megérkeztünk.\n' }] }], facts: {}, photo: null });
    const plain = await binary(
      request(app)
        .get(`/tours/${(await createTour())._id}/report/pdf?draft=1`)
        .set(asUser(admin)),
    );
    const pdf = await binary(
      request(app).get(`/tours/${tour._id}/report/pdf?draft=1`).set(asUser(admin)),
    );
    expect(pdf.status).toBe(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    // Two maps heavier than a beszámoló without any.
    expect(pdf.body.length).toBeGreaterThan(plain.body.length + 10000);
  });

  it("a note can be linked to the hike it happened on - the beszámoló's data points at it", async () => {
    vi.mocked(fetchMapTile).mockRejectedValue(new Error('no map tiles'));
    const admin = await createAdmin();
    const tour = await createTour({ duration: 3, startDate: new Date('2026-07-09T22:00:00Z') });
    const other = await createTour();
    await upload(admin, tour, 'Kékes', gpx({ day: '2026-07-11' }));
    await upload(admin, tour, 'Terv', gpx({ times: false }));
    await upload(admin, other, 'Máshol', gpx({ day: '2026-07-11' }));
    const kekes = await Document.findOne({ name: 'Kékes' });
    const elsewhere = await Document.findOne({ name: 'Máshol' });

    // Only the tour's own walked hikes are offered.
    const got = await request(app).get(`/tours/${tour._id}/report`).set(asUser(admin));
    expect(got.body.data.report.hikes).toEqual([{ id: String(kekes._id), name: 'Kékes' }]);

    await request(app)
      .put(`/tours/${tour._id}/report`)
      .set(asUser(admin))
      .send({
        days: [
          null,
          {
            ops: [
              { insert: 'Valaki ' },
              { insert: 'beleesett a patakba', attributes: { hike: String(kekes._id) } },
              { insert: '\nEste ' },
              { insert: 'tábortűz', attributes: { hike: String(elsewhere._id) } },
              { insert: '\n' },
            ],
          },
        ],
      });
    const res = await request(app).get(`/tours/${tour._id}/report/json?draft=1`).set(asUser(admin));
    const hikeId = `${tour._id}:2:hike:1`;
    expect(res.body.data.chunks.map((c) => [c.id, c.metadata.kind, c.metadata.hikeRef])).toEqual([
      [`${tour._id}:2:1`, 'event', hikeId],
      // Another tour's hike: the link was dropped when saved.
      [`${tour._id}:2:2`, 'event', null],
      [hikeId, 'hike', null],
    ]);
    const hike = res.body.data.chunks[2];
    expect(hike.header).toMatch(/, 2\. nap, 2026-07-11:$/);
    expect(hike.body).toMatch(/^túra – Kékes, 1,6 km, 48 p, \+145 m \/ −0 m$/);
    expect(res.body.data.hikes).toMatchObject([{ name: 'Kékes', day: 2, date: '2026-07-11' }]);
  });
});

// A watch stops at a long lunch, the way on is a new recording: the pieces
// of one day following each other within 2 hours are one hike.
describe('a hike recorded in pieces', () => {
  it('pieces within 2 hours on a day are one hike: numbers added up, one map with the stops', async () => {
    await fakeTiles();
    const admin = await createAdmin();
    const tour = await createTour({ duration: 3, startDate: new Date('2026-07-09T22:00:00Z') });
    // Uploaded in any order - the times put them in theirs. 07:12-08:00,
    // then 09:00-09:48 (a 1-hour stop), then 12:00 (over 2 hours later:
    // another hike), and one the next day.
    await upload(admin, tour, 'velence 2', gpx({ at: '09:00' }));
    await upload(admin, tour, 'Délután', gpx({ at: '12:00' }));
    await upload(admin, tour, 'velence 1', gpx());
    await upload(admin, tour, 'Másnap', gpx({ day: '2026-07-12' }));
    await new Promise((r) => setTimeout(r, 50)); // the uploads' own tries at the map

    const numbers = await tourHikeNumbers(tour);
    expect(numbers.map((h) => [h.name, h.day, h.parts.length])).toEqual([
      ['velence', 1, 2],
      ['Délután', 1, 1],
      ['Másnap', 2, 1],
    ]);
    const joined = numbers[0].track;
    const single = numbers[1].track;
    expect(joined.distanceM).toBeCloseTo(single.distanceM * 2, 0);
    expect(joined.durationSec).toBe(single.durationSec * 2);
    expect(joined.stops).toBe(1);

    const hikes = await tourHikes(tour);
    expect(hikes[0].stats).toEqual([
      ['Indulás', '09:12'],
      ['Érkezés', '11:48'],
      ['Táv', expect.stringMatching(/ km$/)],
      ['Menetidő', '1 ó 37 p'],
      ['Megállók', '1 · 1 ó 00 p'],
      ['Emelkedő', '290 m'],
      ['Lejtő', '0 m'],
    ]);
    // One map of both pieces, beside the first one; the others their own.
    expect(hikes[0].map).toMatch(/-hike-[0-9a-f]{8}-map\.jpg$/);
    expect(fs.existsSync(hikes[0].map)).toBe(true);
    expect(hikes[1].map).toMatch(/[^e]-map\.jpg$/);

    // A piece gone: the joined map goes, and the hike is what's left.
    const second = await Document.findOne({ name: 'velence 2' });
    await request(app).delete(`/documents/${second._id}`).set(asUser(admin));
    await new Promise((r) => setTimeout(r, 50));
    expect(fs.existsSync(hikes[0].map)).toBe(false);
    const after = await tourHikeNumbers(tour);
    expect(after[0]).toMatchObject({ name: 'velence 1', parts: [expect.any(String)] });
  });

  it("a note linked to any piece of a hike stays linked - the beszámoló's hike is the whole", async () => {
    const admin = await createAdmin();
    const tour = await createTour({ duration: 3, startDate: new Date('2026-07-09T22:00:00Z') });
    await upload(admin, tour, 'Cuha szurdok oda', gpx());
    await upload(admin, tour, 'Cuha szurdok vissza', gpx({ at: '08:41' }));
    const back = await Document.findOne({ name: 'Cuha szurdok vissza' });

    await request(app)
      .put(`/tours/${tour._id}/report`)
      .set(asUser(admin))
      .send({
        days: [
          null,
          {
            ops: [
              { insert: 'visszafelé', attributes: { hike: String(back._id) } },
              { insert: '\n' },
            ],
          },
        ],
        facts: {},
        photo: null,
      });
    const got = await request(app).get(`/tours/${tour._id}/report`).set(asUser(admin));
    expect(got.body.data.report.hikes).toEqual([{ id: expect.any(String), name: 'Cuha szurdok' }]);
    expect(JSON.stringify(got.body.data.report.days[1])).toContain(String(back._id));
  });

  it('is named after the words its pieces start with', () => {
    const named = (...names) => outingName(names.map((name) => ({ name })));
    expect(named('velence 4', 'velence 3', 'Velence 2')).toBe('velence');
    expect(named('Cuha szurdok oda', 'Cuha szurdok vissza')).toBe('Cuha szurdok');
    expect(named('Délelőtt', 'Délután')).toBe('Délelőtt');
  });
});
