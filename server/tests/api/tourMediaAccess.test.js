import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import {
  createAdmin,
  createGuest,
  createMember,
  createReservation,
  createTour,
} from '../helpers/factories.js';
import Tour from '../../src/models/tourModel.js';
import { clearTourVideoCache } from '../../src/utils/tourVideos.js';
import { zipsRunning } from '../../src/controllers/tourImageController.js';

// A tour's album and its recap videos: the members' and the admins' - a
// guest's only on a tour they are on themselves (utils/tourMediaAccess.js).
const ORDER = 77;
const FOLDER = 'vendeg-teszt-tabor';

beforeAll(() => {
  const season = path.join(process.env.VIDEOS_ROOT, 'Season 09 - Vendégségben (2020)');
  fs.mkdirSync(season, { recursive: true });
  fs.writeFileSync(path.join(season, `${ORDER} - Valahol (2020) S09E01.mp4`), 'video');
  fs.writeFileSync(path.join(season, `${ORDER} - Valahol (2020) S09E01-thumb.jpg`), 'cover');
  fs.writeFileSync(
    path.join(season, `${ORDER} - Valahol (2020) S09E01.hun.srt`),
    '1\n00:00:01,000 --> 00:00:02,000\nSzia\n',
  );
  const album = path.join(process.env.PHOTOS_ROOT, FOLDER);
  fs.mkdirSync(album, { recursive: true });
  fs.writeFileSync(path.join(album, 'IMG_1.jpg'), 'photo');
});
beforeEach(() => clearTourVideoCache());

async function tourWithMedia() {
  const tour = await createTour({ order: ORDER });
  await Tour.updateOne(
    { _id: tour._id },
    { sourceFolder: FOLDER, images: [{ filename: 'IMG_1.jpg' }] },
  );
  return tour;
}

const get = (user, url) => request(app).get(url).set(asUser(user));
const tourPage = async (user, tour) => (await get(user, `/tours/${tour._id}`)).body.data;

// Every address that gives a photo or a video of the tour.
async function mediaUrls(tour) {
  const [video] = (await tourPage(await createAdmin(), tour)).videos;
  const base = `/tours/${tour._id}`;
  return [
    `${base}/images`,
    `${base}/images/download-zip`,
    `${base}/images/IMG_1.jpg`,
    `${base}/images/IMG_1.jpg/thumb`,
    `${base}/images/IMG_1.jpg/download`,
    `${base}/videos/${video.id}/video`,
    `${base}/videos/${video.id}/cover`,
    `${base}/videos/${video.id}/subtitles.vtt`,
  ];
}

describe("a tour's photos and videos for a guest", () => {
  it('are refused on a tour the guest is not on - the tour page lists no video', async () => {
    const tour = await tourWithMedia();
    const guest = await createGuest();
    // Somebody else's reservation changes nothing.
    await createReservation(tour, [await createGuest()]);

    const page = await tourPage(guest, tour);
    expect(page).toMatchObject({ canSeeMedia: false, hasVideo: false, videos: [] });

    for (const url of await mediaUrls(tour)) {
      expect((await get(guest, url)).status, url).toBe(403);
    }
  });

  it('are given on a tour the guest is on', async () => {
    const tour = await tourWithMedia();
    const guest = await createGuest();
    await createReservation(tour, [await createMember(), guest]);

    const page = await tourPage(guest, tour);
    expect(page.canSeeMedia).toBe(true);
    expect(page.videos).toHaveLength(1);

    const base = `/tours/${tour._id}`;
    const list = await get(guest, `${base}/images`);
    expect(list.status).toBe(200);
    expect(list.body.data.images.map((i) => i.filename)).toEqual(['IMG_1.jpg']);
    expect((await get(guest, `${base}/images/IMG_1.jpg/download`)).status).toBe(200);
    expect((await get(guest, `${base}/images/download-zip`)).status).toBe(200);
    const id = page.videos[0].id;
    expect((await get(guest, `${base}/videos/${id}/video`)).status).toBe(200);
    expect((await get(guest, `${base}/videos/${id}/cover`)).status).toBe(200);
    expect((await get(guest, `${base}/videos/${id}/subtitles.vtt`)).status).toBe(200);

    // Being on one tour opens no other's.
    const other = await tourWithMedia();
    expect((await get(guest, `/tours/${other._id}/images`)).status).toBe(403);
  });

  it('stay open to members and admins who were not on the tour', async () => {
    const tour = await tourWithMedia();
    for (const user of [await createMember(), await createAdmin()]) {
      const page = await tourPage(user, tour);
      expect(page.canSeeMedia).toBe(true);
      expect(page.videos).toHaveLength(1);
      expect((await get(user, `/tours/${tour._id}/images`)).status).toBe(200);
      expect((await get(user, `/tours/${tour._id}/videos/${page.videos[0].id}/video`)).status).toBe(
        200,
      );
    }
  });

  it('cannot be taken into a quiz from a tour the guest is not on', async () => {
    const tour = await tourWithMedia();
    const guest = await createGuest();
    const pick = () =>
      request(app)
        .post('/jatekok/quiz/images/from-tour')
        .set(asUser(guest))
        .send({ tourId: String(tour._id), filename: 'IMG_1.jpg' });

    expect((await pick()).status).toBe(404);
    await createReservation(tour, [guest]);
    // On the tour it gets as far as reading the file - which is no picture.
    expect((await pick()).status).not.toBe(404);
  });
});

// A whole album's originals load the NAS and the home line: one zip at a
// time per person, at most two in all (tourImageController.js).
describe("an album's zip", () => {
  it('one at a time per person, two in all - a busy one is a page to read', async () => {
    const tour = await tourWithMedia();
    const member = await createMember();
    const url = `/tours/${tour._id}/images/download-zip`;

    expect((await get(member, url)).status).toBe(200);
    expect(zipsRunning.size).toBe(0); // freed once it's sent

    zipsRunning.set(String(member._id), 1);
    const mine = await get(member, url);
    expect(mine.status).toBe(429);
    expect(mine.headers['content-type']).toContain('text/html');
    expect(mine.text).toContain('Már töltesz le egy albumot');
    zipsRunning.clear();

    zipsRunning.set('a', 1);
    zipsRunning.set('b', 1);
    const third = await get(member, url);
    expect(third.status).toBe(429);
    expect(third.text).toContain('mások is töltenek le albumot');
    zipsRunning.clear();
    expect((await get(member, url)).status).toBe(200);
  });
});
