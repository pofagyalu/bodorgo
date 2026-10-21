import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { openMediaVideos } from '../helpers/media.js';
import {
  createAdmin,
  createGuest,
  createMember,
  createReservation,
  createTour,
} from '../helpers/factories.js';
import config from '../../src/config.js';
import Tour from '../../src/models/tourModel.js';
import View from '../../src/models/viewModel.js';
import MediaPhoto from '../../src/models/mediaPhotoModel.js';
import MediaPhotoSettings from '../../src/models/mediaPhotoSettingsModel.js';
import { clearTourVideoCache, encodeVideoId } from '../../src/utils/tourVideos.js';
import { clearPlaylistCache } from '../../src/music/jellyfin.js';
import { clearPopularCache } from '../../src/utils/views.js';
import { budapestYmd } from '../../src/utils/huDate.js';

// Megtekintések (utils/views.js): what the pages say was seen - once a day
// per person and item, only what that person may see - and the homepage's
// most viewed of the last 30 days. Photos and videos come from a tour's
// album and from Média alike.

const ORDER = 88;
const TOUR_VIDEO = `Season 03/${ORDER} - Nézettség (2021) S03E01.mp4`;
const MEDIA_VIDEO = 'Season 07/Nézettségi reklám (2023) S07E01.mp4';
const mediaVideoId = Buffer.from(MEDIA_VIDEO, 'utf8').toString('base64url');

beforeAll(async () => {
  // The once-a-day rule (a unique index) in place first: a test file starts
  // on a brand-new database, where it is built a moment after the start.
  await View.init();
  const put = (root, rel) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), 'video');
  };
  put(process.env.VIDEOS_ROOT, TOUR_VIDEO);
  put(path.join(process.env.MEDIA_VIDEOS_ROOT, 'reklam'), MEDIA_VIDEO);
});

// A fake Jellyfin with one playlist (Bódorgó FM) of two songs.
beforeEach(async () => {
  // Every member sees the Média videos (a new one would be the admins' alone).
  await openMediaVideos();
  clearPopularCache();
  clearTourVideoCache();
  clearPlaylistCache();
  Object.assign(config.jellyfin, {
    imageCacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'views-test-')),
    url: 'https://jellyfin.test',
    apiKey: 'secret-key',
    playlistId: 'pl1',
    buliPlaylistId: undefined,
    hatterPlaylistId: undefined,
    userId: 'u1',
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) =>
      String(url).includes('/Playlists/pl1/Items')
        ? new Response(
            JSON.stringify({
              Items: [
                { Id: 'song1', Name: 'Első dal', AlbumArtist: 'Zenekar' },
                { Id: 'song2', Name: 'Második dal', AlbumArtist: 'Zenekar' },
              ],
            }),
            { status: 200 },
          )
        : new Response('nope', { status: 404 }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function tourWithPhotos() {
  const tour = await createTour({ order: ORDER });
  await Tour.updateOne(
    { _id: tour._id },
    {
      sourceFolder: 'nezettseg',
      images: [
        { filename: 'IMG_1.jpg', width: 1200, height: 800 },
        { filename: 'IMG_2.jpg', width: 800, height: 1200 },
        { filename: 'titkos.jpg', width: 1000, height: 1000, restricted: true },
      ],
    },
  );
  return tour;
}

const send = (user, views) => request(app).post('/views').set(asUser(user)).send({ views });
const recorded = async (user, views) => (await send(user, views)).body.data.recorded;
const popular = async (user) =>
  (await request(app).get('/views/popular').set(asUser(user))).body.data;

describe('recording views', () => {
  it('is for the logged in only, and takes a list of at most 50', async () => {
    expect((await request(app).post('/views').send({ views: [] })).status).toBe(401);
    const me = await createMember();
    expect((await send(me, 'x')).status).toBe(400);
    const tour = await createTour();
    const many = Array.from({ length: 51 }, () => ({ type: 'tour', key: String(tour._id) }));
    expect((await send(me, many)).status).toBe(400);
  });

  it('counts an item once a day per person - the next person counts again', async () => {
    const tour = await createTour();
    const view = { type: 'tour', key: String(tour._id) };
    const me = await createMember();
    expect(await recorded(me, [view, view])).toBe(1);
    expect(await recorded(me, [view])).toBe(0);
    expect(await recorded(await createGuest(), [view])).toBe(1);
    // Yesterday's is another day.
    await View.updateMany({}, { day: '2020-01-01' });
    expect(await recorded(me, [view])).toBe(1);
    expect(await View.countDocuments({ key: String(tour._id) })).toBe(3);
  });

  it('takes the plain-text batch a closing page sends (sendBeacon)', async () => {
    const tour = await createTour();
    const res = await request(app)
      .post('/views')
      .set(asUser(await createMember()))
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ views: [{ type: 'tour', key: String(tour._id) }] }));
    expect(res.status).toBe(200);
    expect(res.body.data.recorded).toBe(1);
    const broken = await request(app)
      .post('/views')
      .set(asUser(await createMember()))
      .set('Content-Type', 'text/plain')
      .send('{nem json');
    expect(broken.status).toBe(400);
  });

  it("leaves out what isn't there, or isn't this person's to see", async () => {
    const tour = await tourWithPhotos();
    const photo = (filename) => ({ type: 'photo', key: `tour:${tour._id}:${filename}` });
    const member = await createMember();
    // A restricted photo: only the tour's attendees and the admins.
    expect(
      await recorded(member, [photo('IMG_1.jpg'), photo('titkos.jpg'), photo('nincs.jpg')]),
    ).toBe(1);
    expect(await recorded(await createAdmin(), [photo('titkos.jpg')])).toBe(1);
    // A guest: only on a tour they are on - and never Média.
    const guest = await createGuest();
    await MediaPhoto.create({ category: 'kepek', filename: 'a.jpg', width: 10, height: 10 });
    const mediaPhoto = { type: 'photo', key: 'media:kepek:a.jpg' };
    expect(await recorded(guest, [photo('IMG_1.jpg'), mediaPhoto])).toBe(0);
    await createReservation(tour, [guest]);
    expect(await recorded(guest, [photo('IMG_1.jpg'), photo('titkos.jpg'), mediaPhoto])).toBe(2);
    // Junk.
    expect(
      await recorded(member, [
        { type: 'tour', key: 'nem-id' },
        { type: 'mozi', key: 'x' },
        { type: 'photo', key: 'valami' },
        { type: 'track', key: 'song1' }, // no playlist
        null,
      ]),
    ).toBe(0);
  });

  it('a Média photo kept for some members counts only for them', async () => {
    await MediaPhoto.create({ category: 'kepek', filename: 'b.jpg', width: 10, height: 10 });
    const chosen = await createMember();
    await MediaPhotoSettings.create({
      category: 'kepek',
      filename: 'b.jpg',
      viewers: [chosen._id],
    });
    const view = { type: 'photo', key: 'media:kepek:b.jpg' };
    expect(await recorded(await createMember(), [view])).toBe(0);
    expect(await recorded(chosen, [view])).toBe(1);
  });

  it("counts a tour's video and a Média video", async () => {
    const tour = await createTour({ order: ORDER });
    const me = await createMember();
    expect(
      await recorded(me, [
        { type: 'video', key: `tour:${tour._id}:${encodeVideoId(TOUR_VIDEO)}` },
        { type: 'video', key: `media:reklam:${mediaVideoId}` },
        { type: 'video', key: `media:reklam:${encodeVideoId('nincs ilyen.mp4')}` },
        { type: 'video', key: `media:nincs:${mediaVideoId}` },
      ]),
    ).toBe(2);
  });

  it('counts a song of a playlist', async () => {
    const me = await createGuest();
    expect(
      await recorded(me, [
        { type: 'track', key: 'song1', playlist: 'bodorgo-fm' },
        { type: 'track', key: 'song9', playlist: 'bodorgo-fm' },
        { type: 'track', key: 'song2', playlist: 'nincs' },
      ]),
    ).toBe(1);
    expect(await View.findOne({ key: 'song1' })).toMatchObject({ playlist: 'bodorgo-fm' });
  });
});

describe('the most viewed (homepage)', () => {
  // `count` different people's views of it, `daysAgo` days ago.
  async function viewsOf(type, key, count, { daysAgo = 0, playlist } = {}) {
    const day = budapestYmd(new Date(Date.now() - daysAgo * 24 * 3600 * 1000));
    for (let i = 0; i < count; i++) {
      const user = await createMember();
      await View.create({ type, key, user: user._id, day, playlist });
    }
  }

  it('is null for every kind while nothing was seen', async () => {
    expect(await popular(await createMember())).toEqual({
      days: 30,
      photo: null,
      video: null,
      tour: null,
      track: null,
      song: null,
    });
  });

  it('gives the most viewed of the last 30 days that this person may see', async () => {
    const tour = await tourWithPhotos();
    const key = (filename) => `tour:${tour._id}:${filename}`;
    await viewsOf('photo', key('titkos.jpg'), 5);
    await viewsOf('photo', key('IMG_2.jpg'), 3);
    await viewsOf('photo', key('IMG_1.jpg'), 2);
    // Older than 30 days: not counted.
    await viewsOf('photo', key('IMG_1.jpg'), 4, { daysAgo: 30 });
    // Seen recently by the same people over several days: each day a view.
    await viewsOf('photo', key('IMG_1.jpg'), 0);

    // The restricted one is the admins' (and the attendees') top photo.
    expect((await popular(await createAdmin())).photo).toMatchObject({
      filename: 'titkos.jpg',
      views: 5,
      viewers: 5,
    });
    // Anyone else gets the next one.
    const { photo } = await popular(await createMember());
    expect(photo).toEqual({
      source: 'tour',
      key: key('IMG_2.jpg'),
      title: `${ORDER}. ${tour.title}`,
      link: `/taborok/${tour.slug}`,
      filename: 'IMG_2.jpg',
      width: 800,
      height: 1200,
      fullUrl: `/tours/${tour._id}/images/IMG_2.jpg`,
      thumbUrl: `/tours/${tour._id}/images/IMG_2.jpg/thumb`,
      downloadUrl: `/tours/${tour._id}/images/IMG_2.jpg/download`,
      views: 3,
      viewers: 3,
    });
    // A guest who isn't on the tour: none of its photos.
    expect((await popular(await createGuest())).photo).toBeNull();
  });

  it('counts one person on many days as many views, but one viewer', async () => {
    const tour = await createTour();
    const me = await createMember();
    for (const day of [budapestYmd(), budapestYmd(new Date(Date.now() - 86400000))]) {
      await View.create({ type: 'tour', key: String(tour._id), user: me._id, day });
    }
    expect((await popular(me)).tour).toMatchObject({
      id: String(tour._id),
      title: tour.title,
      link: `/taborok/${tour.slug}`,
      coverUrl: null,
      views: 2,
      viewers: 1,
    });
  });

  it('gives a Média photo, a video and a song ready to be opened', async () => {
    await MediaPhoto.create({
      category: 'kepek',
      album: '2019',
      filename: '2019/c.jpg',
      width: 30,
      height: 20,
    });
    await viewsOf('photo', 'media:kepek:2019/c.jpg', 1);
    await viewsOf('video', `media:reklam:${mediaVideoId}`, 2);
    await viewsOf('track', 'song2', 2, { playlist: 'bodorgo-fm' });
    const top = await popular(await createMember());
    expect(top.photo).toMatchObject({
      source: 'media',
      title: '2019',
      link: '/media/fotok/kepek/2019',
      fullUrl: '/media/photos/kepek/2019%2Fc.jpg',
    });
    expect(top.video).toMatchObject({
      source: 'media',
      title: 'Nézettségi reklám',
      subtitle: 'Reklámok · 2023',
      link: '/media/videok/reklam',
      src: `/media/videos/reklam/${mediaVideoId}/video?quality=original`,
      smallSrc: null,
      subtitlesSrc: null,
      views: 2,
    });
    expect(top.track).toMatchObject({
      playlist: 'bodorgo-fm',
      id: 'song2',
      title: 'Második dal',
      artist: 'Zenekar',
      views: 2,
    });
    // Média isn't a guest's.
    const guestTop = await popular(await createGuest());
    expect([guestTop.photo, guestTop.video]).toEqual([null, null]);
    expect(guestTop.track).toMatchObject({ id: 'song2' });
  });

  it("gives a tour's video with its tour", async () => {
    const tour = await createTour({ order: ORDER });
    const id = encodeVideoId(TOUR_VIDEO);
    await viewsOf('video', `tour:${tour._id}:${id}`, 1);
    expect((await popular(await createMember())).video).toMatchObject({
      source: 'tour',
      title: 'Tábori videó',
      subtitle: `${ORDER}. ${tour.title}`,
      link: `/taborok/${tour.slug}`,
      src: `/tours/${tour._id}/videos/${id}/video?quality=original`,
    });
  });
});
