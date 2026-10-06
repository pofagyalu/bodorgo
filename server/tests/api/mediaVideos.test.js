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
// With a height: also a picture track whose "tkhd" ends in its width and
// height (16.16 fixed-point), and a sound track (0 x 0) after it.
function tinyMp4(seconds, timescale = 1000, height = 0) {
  const box = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + body.length, 0);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, body]);
  };
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(timescale, 12);
  mvhd.writeUInt32BE(seconds * timescale, 16);
  const trak = (lines) => {
    const tkhd = Buffer.alloc(84);
    tkhd.writeUInt32BE(Math.round((lines * 16) / 9) * 65536, 76);
    tkhd.writeUInt32BE(lines * 65536, 80);
    return box('trak', box('tkhd', tkhd));
  };
  const tracks = height ? [trak(height), trak(0)] : [];
  return Buffer.concat([
    box('ftyp', Buffer.from('isom0000isom')),
    box('moov', Buffer.concat([box('mvhd', mvhd), ...tracks])),
  ]);
}

beforeAll(() => {
  put('farsang/folder.jpg');
  put('farsang/Season 01/Farsang (2024) S01E01.mp4', 'video-2024');
  put('farsang/Season 01/Farsang (2024) S01E01-thumb.jpg', 'thumb-2024');
  put('farsang/Season 01/Farsang (2025) S01E02.mp4', tinyMp4(754, 1000, 1080));
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
    // So do the picture's lines, and with them the small copy's: 720 at
    // most (what the player's quality switch is labelled with).
    expect(farsang.videos.map((v) => [v.height, v.smallHeight])).toEqual([
      [1080, 720],
      [null, null],
    ]);
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

// Only the role manager edits a video - no other admin.
const createManager = () => createAdmin({ canManageRoles: true });

describe('Média videos: own title and viewers', () => {
  const base = '/media/videos/farsang';
  const farsang = async (user) =>
    (await request(app).get('/media/videos').set(asUser(user))).body.data.categories.find(
      (c) => c.key === 'farsang',
    );

  it('the role manager gives a video its own title, and takes it back', async () => {
    const admin = await createManager();
    const [video] = (await farsang(admin)).videos;
    expect((await farsang(admin)).videos[0].viewers).toEqual([]);

    const member = await createMember();
    const otherAdmin = await createAdmin();
    for (const user of [member, otherAdmin]) {
      expect(
        (await request(app).patch(`${base}/${video.id}`).set(asUser(user)).send({ title: 'x' }))
          .status,
      ).toBe(403);
    }

    const res = await request(app)
      .patch(`${base}/${video.id}`)
      .set(asUser(admin))
      .send({ title: '  Jelmezbál  ' });
    expect(res.body.data.video).toMatchObject({
      title: 'Jelmezbál',
      discoveredTitle: 'Farsang',
      viewers: [],
    });
    expect((await farsang(member)).videos[0].title).toBe('Jelmezbál');

    await request(app).patch(`${base}/${video.id}`).set(asUser(admin)).send({ title: '' });
    expect((await farsang(member)).videos[0].title).toBe('Farsang');
  });

  it('a video with viewers is only there for them and the admins', async () => {
    const admin = await createManager();
    const otherAdmin = await createAdmin();
    const chosen = await createMember();
    const other = await createMember();
    // The 2025 one: it has subtitles; the 2024 one stays open to everyone.
    const [video] = (await farsang(admin)).videos;

    const res = await request(app)
      .patch(`${base}/${video.id}`)
      .set(asUser(admin))
      .send({ viewers: [String(chosen._id), String(chosen._id)] });
    expect(res.status).toBe(200);
    expect(res.body.data.video.viewers).toEqual([String(chosen._id)]);

    // Only the role manager is told who the viewers are; any admin sees it.
    expect((await farsang(admin)).videos[0].viewers).toEqual([String(chosen._id)]);
    expect((await farsang(otherAdmin)).videos.map((v) => v.year)).toEqual([2025, 2024]);
    expect((await farsang(otherAdmin)).videos[0].viewers).toBeUndefined();
    const forChosen = await farsang(chosen);
    expect(forChosen.videos.map((v) => v.year)).toEqual([2025, 2024]);
    expect(forChosen.videos[0].viewers).toBeUndefined();
    expect((await farsang(other)).videos.map((v) => v.year)).toEqual([2024]);

    const get = (user, what, id = video.id) =>
      request(app).get(`${base}/${id}/${what}`).set(asUser(user));
    expect((await get(chosen, 'video')).status).toBe(200);
    expect((await get(admin, 'video')).status).toBe(200);
    expect((await get(other, 'video')).status).toBe(404);
    expect((await get(other, 'subtitles.vtt')).status).toBe(404);
    expect((await get(other, 'cover')).status).toBe(404);
    // The same file under another spelling of its path is no way in.
    const respelled = Buffer.from('Season 01/./Farsang (2025) S01E02.mp4').toString('base64url');
    expect((await get(other, 'video', respelled)).status).toBe(404);
    expect((await get(chosen, 'video', respelled)).status).toBe(200);

    // A title change leaves the viewers alone; an empty list opens it again.
    await request(app).patch(`${base}/${video.id}`).set(asUser(admin)).send({ title: 'Új' });
    expect((await get(other, 'video')).status).toBe(404);
    await request(app).patch(`${base}/${video.id}`).set(asUser(admin)).send({ viewers: [] });
    expect((await get(other, 'video')).status).toBe(200);
    expect((await farsang(other)).videos[0].title).toBe('Új');
    await request(app).patch(`${base}/${video.id}`).set(asUser(admin)).send({ title: '' });
  });

  it('refuses viewers that are not users', async () => {
    const admin = await createManager();
    const [video] = (await farsang(admin)).videos;
    const patch = (viewers) =>
      request(app).patch(`${base}/${video.id}`).set(asUser(admin)).send({ viewers });
    expect((await patch('mindenki')).status).toBe(400);
    expect((await patch(['nem-id'])).status).toBe(400);
    expect((await patch(['64b000000000000000000000'])).status).toBe(400);
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
