import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember, createTour } from '../helpers/factories.js';
import Tour from '../../src/models/tourModel.js';
import { backgroundPath, isoWeek, landscapePhotos } from '../../src/chat/chatBackground.js';

// The Kotyogó's background: a pale landscape photo from the tour's album,
// changing weekly (see chat/chatBackground.js).
const photosRoot = process.env.PHOTOS_ROOT;
const FOLDER = '2409_background_test_xxx';

async function putJpeg(name, width, height, background = '#205080') {
  const file = path.join(photosRoot, FOLDER, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background } })
    .jpeg()
    .toFile(file);
}

const IMAGES = [
  { filename: 'wide1.jpg', width: 1600, height: 900 },
  { filename: 'wide2.jpg', width: 1500, height: 1000 },
  { filename: 'tall.jpg', width: 900, height: 1600 },
  { filename: 'secret.jpg', width: 1600, height: 900, restricted: true },
];

beforeAll(async () => {
  for (const i of IMAGES) await putJpeg(i.filename, i.width, i.height);
});

async function tourWithAlbum(images = IMAGES) {
  const tour = await createTour();
  await Tour.updateOne({ _id: tour._id }, { sourceFolder: FOLDER, images });
  return tour;
}

const savedPick = async (tour) =>
  (await Tour.findById(tour._id).select('+chatBackground')).chatBackground;

describe('Kotyogó background', () => {
  it('knows the ISO week', () => {
    expect(isoWeek(new Date(2026, 8, 29))).toBe('2026-W40');
    expect(isoWeek(new Date(2027, 0, 1))).toBe('2026-W53');
    expect(isoWeek(new Date(2025, 11, 29))).toBe('2026-W01');
  });

  it('only takes landscape photos that everyone may see', () => {
    expect(landscapePhotos(IMAGES).map((i) => i.filename)).toEqual(['wide1.jpg', 'wide2.jpg']);
  });

  it("makes this week's pale background once, and serves it", async () => {
    const tour = await tourWithAlbum();
    const member = await createMember();

    const res = await request(app).get(`/tours/${tour._id}/chat/background`).set(asUser(member));
    expect(res.status).toBe(200);
    const { version } = res.body.data.background;
    expect(version.startsWith(`${isoWeek()}.`)).toBe(true);
    const pick = await savedPick(tour);
    expect(['wide1.jpg', 'wide2.jpg']).toContain(pick.filename);
    expect(pick.week).toBe(isoWeek());

    // Pale: the dark blue test photo (red 0x20) comes out 75% white.
    const file = backgroundPath(tour._id);
    const { channels } = await sharp(file).stats();
    expect(channels[0].mean).toBeGreaterThan(190);
    expect(channels[0].mean).toBeLessThan(210);
    const madeAt = fs.statSync(file).mtimeMs;

    const again = await request(app).get(`/tours/${tour._id}/chat/background`).set(asUser(member));
    expect(again.body.data.background.version).toBe(version);
    expect(fs.statSync(file).mtimeMs).toBe(madeAt);

    const image = await request(app)
      .get(`/tours/${tour._id}/chat/background/image?v=${version}`)
      .set(asUser(member));
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toContain('image/webp');
    expect(image.headers['cache-control']).toBe('private, max-age=31536000');
  });

  it('a new week (or a photo gone from the album) brings a new one', async () => {
    const tour = await tourWithAlbum();
    await Tour.updateOne(
      { _id: tour._id },
      { chatBackground: { filename: 'wide1.jpg', week: '2020-W01' } },
    );
    const member = await createMember();
    await request(app).get(`/tours/${tour._id}/chat/background`).set(asUser(member));
    expect((await savedPick(tour)).week).toBe(isoWeek());

    await Tour.updateOne(
      { _id: tour._id },
      { chatBackground: { filename: 'gone.jpg', week: isoWeek() } },
    );
    await request(app).get(`/tours/${tour._id}/chat/background`).set(asUser(member));
    expect(['wide1.jpg', 'wide2.jpg']).toContain((await savedPick(tour)).filename);
  });

  it('none for a tour without landscape photos', async () => {
    const tour = await tourWithAlbum([IMAGES[2], IMAGES[3]]);
    const member = await createMember();
    const res = await request(app).get(`/tours/${tour._id}/chat/background`).set(asUser(member));
    expect(res.body.data.background).toBeNull();
    const plain = await createTour();
    const none = await request(app).get(`/tours/${plain._id}/chat/background`).set(asUser(member));
    expect(none.body.data.background).toBeNull();
  });

  it('an admin picks another one ("Másik háttér")', async () => {
    const tour = await tourWithAlbum();
    const member = await createMember();
    await request(app).get(`/tours/${tour._id}/chat/background`).set(asUser(member));
    const before = (await savedPick(tour)).filename;

    const denied = await request(app)
      .post(`/tours/${tour._id}/chat/background/next`)
      .set(asUser(member));
    expect(denied.status).toBe(403);

    const admin = await createAdmin();
    const res = await request(app)
      .post(`/tours/${tour._id}/chat/background/next`)
      .set(asUser(admin));
    expect(res.status).toBe(200);
    const after = await savedPick(tour);
    expect(after.filename).not.toBe(before);
    expect(after.week).toBe(isoWeek());
    // It stays for the rest of the week.
    const got = await request(app).get(`/tours/${tour._id}/chat/background`).set(asUser(member));
    expect(got.body.data.background.version).toBe(res.body.data.background.version);

    const only = await tourWithAlbum([IMAGES[0]]);
    await request(app).get(`/tours/${only._id}/chat/background`).set(asUser(member));
    const none = await request(app)
      .post(`/tours/${only._id}/chat/background/next`)
      .set(asUser(admin));
    expect(none.status).toBe(409);
  });
});
