import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createMember, createReservation, createTour } from '../helpers/factories.js';
import Tour from '../../src/models/tourModel.js';
import sendResendEmail from '../../src/utils/resendEmail.js';
import { clearTourVideoCache, parseTourVideoName } from '../../src/utils/tourVideos.js';
import { checkForNewTourVideos } from '../../src/controllers/tourVideoController.js';

// A small copy of the a-bodorgo-klan library in the test's temporary
// folder (see setup.js's VIDEOS_ROOT).
const root = process.env.VIDEOS_ROOT;
const put = (rel, content = 'x') => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
};
const season = 'Season 06 - Messzi vizeken (2017)';

beforeAll(() => {
  put(`${season}/10 - Sarud (2017) - Kilians Cut - S06E01.mp4`, 'kilian');
  put(`${season}/10 - Sarud (2017) - Directors Cut - S06E01.mp4`, 'director');
  put(`${season}/10 - Sarud (2017) - Directors Cut - S06E01-thumb.jpg`);
  put(`${season}/11 - Őrség (2017) S06E02.mp4`, 'orseg');
  put(`${season}/11 - Őrség (2017) S06E02.hun.srt`, '1\n00:00:01,000 --> 00:00:02,000\nSzia\n');
  put(`${season}/folder.jpg`);
});
beforeEach(() => clearTourVideoCache());

const buffered = (req) =>
  req.buffer(true).parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });

describe('tour videos, matched by tour number', () => {
  it('lists every version on the tour page, sorted by name', async () => {
    const tour = await createTour({ order: 10 });
    const res = await request(app).get(`/tours/${tour._id}`).set(asUser(await createMember()));
    expect(res.body.data.hasVideo).toBe(true);
    expect(res.body.data.videos.map((v) => [v.label, v.hasCover])).toEqual([
      ['Rendezői változat', true],
      ['Kilián-féle vágás', false],
    ]);

    const single = await createTour({ order: 11 });
    const res11 = await request(app).get(`/tours/${single._id}`).set(asUser(await createMember()));
    expect(res11.body.data.videos).toEqual([expect.objectContaining({ label: '', hasSubtitles: true })]);

    const none = await createTour({ order: 12 });
    const res12 = await request(app).get(`/tours/${none._id}`).set(asUser(await createMember()));
    expect(res12.body.data).toMatchObject({ hasVideo: false, videos: [] });
  });

  it("streams a tour's own videos, cover and subtitles - never another tour's", async () => {
    const member = await createMember();
    const tour10 = await createTour({ order: 10 });
    const tour11 = await createTour({ order: 11 });
    const [director, kilian] = (await request(app).get(`/tours/${tour10._id}`).set(asUser(member))).body.data.videos;
    const [orseg] = (await request(app).get(`/tours/${tour11._id}`).set(asUser(member))).body.data.videos;
    const base = `/tours/${tour10._id}/videos`;

    const video = await buffered(request(app).get(`${base}/${kilian.id}/video`).set(asUser(member)));
    expect(video.status).toBe(200);
    expect(video.body.toString()).toBe('kilian');
    expect((await request(app).get(`${base}/${director.id}/cover`).set(asUser(member))).status).toBe(200);
    expect((await request(app).get(`${base}/${kilian.id}/cover`).set(asUser(member))).status).toBe(404);

    const subs = await request(app).get(`/tours/${tour11._id}/videos/${orseg.id}/subtitles.vtt`).set(asUser(member));
    expect(subs.text).toContain('00:00:01.000 --> 00:00:02.000');

    // Tour 11's video through tour 10's address, a made-up id, no login.
    expect((await request(app).get(`${base}/${orseg.id}/video`).set(asUser(member))).status).toBe(404);
    const fake = Buffer.from('../../secret.mp4').toString('base64url');
    expect((await request(app).get(`${base}/${fake}/video`).set(asUser(member))).status).toBe(404);
    expect((await request(app).get(`${base}/${kilian.id}/video`)).status).toBe(401);
  });
});

describe('the 12-hourly "video is ready" e-mail', () => {
  it('first run only marks existing videos; later a new one is e-mailed once', async () => {
    const tour10 = await createTour({ order: 10 });
    const attendee = await createMember({ lastLoginAt: new Date() });
    await createReservation(tour10, [attendee]);

    // First run ever: nothing announced yet - just marked, no e-mails.
    expect(await checkForNewTourVideos()).toMatchObject({ seeded: 1, notified: [] });
    expect(sendResendEmail).not.toHaveBeenCalled();

    // Tour 11's video "appears" (its tour is created after the first run).
    const tour11 = await createTour({ order: 11 });
    await createReservation(tour11, [attendee]);
    expect(await checkForNewTourVideos()).toMatchObject({ notified: [11] });
    expect(sendResendEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendResendEmail).mock.calls[0][0]).toMatchObject({ to: attendee.email });

    // Told once: the next check sends nothing more.
    await checkForNewTourVideos();
    expect(sendResendEmail).toHaveBeenCalledTimes(1);
    expect((await Tour.findById(tour11._id)).videoNotifiedAt).toBeInstanceOf(Date);
  });
});

describe('parseTourVideoName', () => {
  it('reads the tour number and version name', () => {
    expect(parseTourVideoName('10 - Sarud (2017) - Directors Cut - S06E01.mp4')).toEqual({ order: 10, label: 'Directors Cut' });
    expect(parseTourVideoName('03 - Jeli arborétum-Sárvár (2013) S02E01.mp4')).toEqual({ order: 3, label: '' });
    expect(parseTourVideoName('01 - Szalajkavölgy - Az eltűnt víz nyomában (2012) - S01E01.mp4')).toEqual({
      order: 1,
      label: '',
    });
    expect(parseTourVideoName('Bónusz jelenetek.mp4')).toBeNull();
  });
});
