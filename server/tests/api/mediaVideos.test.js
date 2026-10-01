import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createGuest, createMember } from '../helpers/factories.js';
import { parseVideoName } from '../../src/controllers/mediaVideoController.js';

// A small Jellyfin-style library in the test's temporary folder (see
// setup.js's MEDIA_VIDEOS_ROOT).
const root = process.env.MEDIA_VIDEOS_ROOT;
const put = (rel, content = 'x') => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
};

// The smallest file an MP4 length can be read from: "ftyp", then "moov"
// holding an "mvhd" that says duration / timescale seconds.
function tinyMp4(seconds, timescale = 1000) {
  const box = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + body.length, 0);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, body]);
  };
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(timescale, 12);
  mvhd.writeUInt32BE(seconds * timescale, 16);
  return Buffer.concat([box('ftyp', Buffer.from('isom0000isom')), box('moov', box('mvhd', mvhd))]);
}

beforeAll(() => {
  put('farsang/folder.jpg');
  put('farsang/Season 01/Farsang (2024) S01E01.mp4', 'video-2024');
  put('farsang/Season 01/Farsang (2024) S01E01-thumb.jpg', 'thumb-2024');
  put('farsang/Season 01/Farsang (2025) S01E02.mp4', tinyMp4(754));
  put(
    'farsang/Season 01/Farsang (2025) S01E02.hun.srt',
    '1\n00:00:01,000 --> 00:00:02,500\nHelló\n',
  );
  put('reklam/Season 01/A magyar igazság (2024) S01E01 .mp4');
  put('reklam/Season 01/A magyar igazság (2024) S01E01 -thumb.jpg');
  put('farsang/notes.txt'); // not a video - ignored
});

describe('Média videos', () => {
  it('lists the categories with their videos, newest first, for members only', async () => {
    const res = await request(app)
      .get('/media/videos')
      .set(asUser(await createMember()));
    expect(res.status).toBe(200);
    const [farsang, reklam] = res.body.data.categories;
    expect(res.body.data.categories.map((c) => c.key)).toEqual(['farsang', 'reklam']); // empty ones left out
    expect(farsang).toMatchObject({ title: 'Farsangok', hasCover: true });
    expect(farsang.videos.map((v) => [v.year, v.hasCover, v.hasSubtitles])).toEqual([
      [2025, false, true],
      [2024, true, false],
    ]);
    // The length comes from the file itself - null where it can't be read
    // (the 2024 one here isn't a real video).
    expect(farsang.videos.map((v) => v.durationSeconds)).toEqual([754, null]);
    // The stray space before "-thumb" still finds the cover.
    expect(reklam.videos[0]).toMatchObject({
      title: 'A magyar igazság',
      year: 2024,
      hasCover: true,
    });

    expect(
      (
        await request(app)
          .get('/media/videos')
          .set(asUser(await createGuest()))
      ).status,
    ).toBe(403);
    expect((await request(app).get('/media/videos')).status).toBe(401);
    expect(
      (
        await request(app)
          .get('/media/videos')
          .set(asUser(await createAdmin()))
      ).status,
    ).toBe(200);
  });

  it('streams a video, its cover and subtitles, and the category cover', async () => {
    const member = await createMember();
    const list = await request(app).get('/media/videos').set(asUser(member));
    const [v2025, v2024] = list.body.data.categories[0].videos;
    const base = '/media/videos/farsang';

    const video = await request(app)
      .get(`${base}/${v2024.id}/video`)
      .set(asUser(member))
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(video.status).toBe(200);
    expect(video.body.toString()).toBe('video-2024');
    const ranged = await request(app)
      .get(`${base}/${v2024.id}/video`)
      .set(asUser(member))
      .set('Range', 'bytes=0-4');
    expect(ranged.status).toBe(206);

    const cover = await request(app).get(`${base}/${v2024.id}/cover`).set(asUser(member));
    expect(cover.status).toBe(200);
    expect(cover.headers['content-type']).toBe('image/jpeg');
    expect((await request(app).get(`${base}/${v2025.id}/cover`).set(asUser(member))).status).toBe(
      404,
    );

    const subs = await request(app).get(`${base}/${v2025.id}/subtitles.vtt`).set(asUser(member));
    expect(subs.text).toBe('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\nHelló\n');

    expect((await request(app).get(`${base}/cover`).set(asUser(member))).status).toBe(200);
    expect((await request(app).get('/media/videos/reklam/cover').set(asUser(member))).status).toBe(
      404,
    );
  });

  it('refuses anything outside the category folder, or not a video', async () => {
    const member = await createMember();
    const id = (rel) => Buffer.from(rel).toString('base64url');
    const get = (url) => request(app).get(url).set(asUser(member));
    expect(
      (
        await get(
          `/media/videos/farsang/${id('../reklam/Season 01/A magyar igazság (2024) S01E01 .mp4')}/video`,
        )
      ).status,
    ).toBe(400);
    expect((await get(`/media/videos/farsang/${id('notes.txt')}/video`)).status).toBe(404);
    expect(
      (await get(`/media/videos/farsang/${id('Season 01/nincs (2020) S01E09.mp4')}/video`)).status,
    ).toBe(404);
    expect((await get(`/media/videos/nincs/${id('x.mp4')}/video`)).status).toBe(404);
  });
});

describe('parseVideoName', () => {
  it('reads Jellyfin-style names', () => {
    expect(parseVideoName('Season 01/Farsang (2025) S01E02.mp4')).toEqual({
      title: 'Farsang',
      year: 2025,
      season: 1,
      episode: 2,
    });
    expect(parseVideoName('A dal (2026) S01E3 Bodorgunk.mp4')).toMatchObject({
      title: 'A dal – Bodorgunk',
      episode: 3,
    });
    expect(parseVideoName('Valami más.mp4')).toEqual({
      title: 'Valami más',
      year: null,
      season: null,
      episode: null,
    });
  });
});
