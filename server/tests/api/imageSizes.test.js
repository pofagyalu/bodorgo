import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember, createTour } from '../helpers/factories.js';
import MediaPhoto from '../../src/models/mediaPhotoModel.js';
import Tour from '../../src/models/tourModel.js';
import ClubSettings from '../../src/models/clubSettingsModel.js';
import { getClubSettings } from '../../src/utils/clubSettings.js';
import { clearImageCache, enforceImageCacheQuota, sizedPath } from '../../src/photos/imageSizes.js';

// Kép gyorsítótár: the smaller WebP versions the viewer asks for with ?w=
// (see photos/imageSizes.js), made on first request and kept in
// THUMBNAILS_ROOT/_sizes/.
const mediaRoot = process.env.MEDIA_PHOTOS_ROOT;
const photosRoot = process.env.PHOTOS_ROOT;
const CATEGORY = 'posters';
const TOUR_FOLDER = '2408_sizes_test_xxix';

async function putJpeg(file, width, height) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: '#a84' } })
    .jpeg()
    .toFile(file);
}

// supertest hands an image back as a Buffer.
const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

async function getPhoto(member, url) {
  return request(app).get(url).set(asUser(member)).buffer(true).parse(binary);
}

beforeAll(async () => {
  await putJpeg(path.join(mediaRoot, CATEGORY, 'big.jpg'), 2400, 1600);
  await putJpeg(path.join(mediaRoot, CATEGORY, 'small.jpg'), 300, 200);
  await putJpeg(path.join(photosRoot, TOUR_FOLDER, 'mobil', 'IMG_9.jpg'), 1500, 2000);
});

async function recordMediaPhotos() {
  await MediaPhoto.create([
    { category: CATEGORY, filename: 'big.jpg', width: 2400, height: 1600 },
    { category: CATEGORY, filename: 'small.jpg', width: 300, height: 200 },
  ]);
}

describe('Kép gyorsítótár: smaller versions for the viewer', () => {
  it('makes a WebP of the asked-for width once, then serves it from the cache', async () => {
    await recordMediaPhotos();
    const member = await createMember();

    const res = await getPhoto(member, `/media/photos/${CATEGORY}/big.jpg?w=800`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/webp');
    expect(res.headers['cache-control']).toBe('private, max-age=31536000');
    const meta = await sharp(res.body).metadata();
    expect([meta.width, meta.height]).toEqual([800, 533]);

    const cached = sizedPath(`media/${CATEGORY}`, 'big.jpg', 800);
    expect(fs.existsSync(cached)).toBe(true);
    const madeAt = fs.statSync(cached).mtimeMs;
    const again = await getPhoto(member, `/media/photos/${CATEGORY}/big.jpg?w=800`);
    expect(again.body.equals(res.body)).toBe(true);
    expect(fs.statSync(cached).mtimeMs).toBe(madeAt);

    // Without ?w= it's still the original.
    const original = await getPhoto(member, `/media/photos/${CATEGORY}/big.jpg`);
    expect(original.headers['content-type']).toContain('image/jpeg');
  });

  it('never enlarges, and only takes the listed widths', async () => {
    await recordMediaPhotos();
    const member = await createMember();
    const res = await getPhoto(member, `/media/photos/${CATEGORY}/small.jpg?w=1920`);
    expect((await sharp(res.body).metadata()).width).toBe(300);

    const odd = await request(app)
      .get(`/media/photos/${CATEGORY}/small.jpg?w=1000`)
      .set(asUser(member));
    expect(odd.status).toBe(400);
    const unknown = await request(app)
      .get(`/media/photos/${CATEGORY}/nope.jpg?w=800`)
      .set(asUser(member));
    expect(unknown.status).toBe(404);
  });

  it("works for a tour's phone photo, keeping it upright by width", async () => {
    const tour = await createTour();
    await Tour.updateOne(
      { _id: tour._id },
      {
        sourceFolder: TOUR_FOLDER,
        images: [{ filename: 'mobil/IMG_9.jpg', width: 1500, height: 2000, source: 'mobile' }],
      },
    );
    const member = await createMember();
    const encoded = encodeURIComponent('mobil/IMG_9.jpg');
    const res = await getPhoto(member, `/tours/${tour._id}/images/${encoded}?w=1200`);
    expect(res.status).toBe(200);
    const meta = await sharp(res.body).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 1600]);
    expect(fs.existsSync(sizedPath(`tours/${TOUR_FOLDER}`, 'mobil/IMG_9.jpg', 1200))).toBe(true);
  });

  it('over the quota, the least recently viewed versions go first', async () => {
    await recordMediaPhotos();
    const member = await createMember();
    clearImageCache(); // only these two versions in it
    await getPhoto(member, `/media/photos/${CATEGORY}/big.jpg?w=1920`);
    await getPhoto(member, `/media/photos/${CATEGORY}/big.jpg?w=1200`);
    const older = sizedPath(`media/${CATEGORY}`, 'big.jpg', 1920);
    const newer = sizedPath(`media/${CATEGORY}`, 'big.jpg', 1200);
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    fs.utimesSync(older, lastWeek, lastWeek);

    // A quota the newer one alone fits into (with the 10% headroom).
    await getClubSettings();
    const quotaBytes = fs.statSync(newer).size / 0.9 + 1;
    await ClubSettings.updateOne(
      { key: 'club' },
      { 'imageCache.quotaMB': quotaBytes / (1024 * 1024) },
    );

    expect(await enforceImageCacheQuota()).toBe(1);
    expect(fs.existsSync(older)).toBe(false);
    expect(fs.existsSync(newer)).toBe(true);
  });
});

describe('Kép gyorsítótár in Beállítások', () => {
  it('shows the usage, sets the quota (logged), and empties the cache - admins only', async () => {
    await recordMediaPhotos();
    const member = await createMember();
    await getPhoto(member, `/media/photos/${CATEGORY}/big.jpg?w=800`);

    expect((await request(app).get('/settings/image-cache').set(asUser(member))).status).toBe(403);

    const admin = await createAdmin({ name: 'Admin Anna' });
    const got = await request(app).get('/settings/image-cache').set(asUser(admin));
    expect(got.status).toBe(200);
    expect(got.body.data.quotaMB).toBe(5120);
    expect(got.body.data.usage.count).toBeGreaterThanOrEqual(1);
    expect(got.body.data.usage.bytes).toBeGreaterThan(0);

    const bad = await request(app)
      .put('/settings/image-cache')
      .set(asUser(admin))
      .send({ quotaMB: 10 });
    expect(bad.status).toBe(400);

    const put = await request(app)
      .put('/settings/image-cache')
      .set(asUser(admin))
      .send({ quotaMB: 2048 });
    expect(put.status).toBe(200);
    expect(put.body.data).toMatchObject({ quotaMB: 2048, removed: 0 });
    const { history } = await getClubSettings();
    expect(history.at(-1).change).toBe('Kép gyorsítótár: 5120 MB → 2048 MB');

    const cleared = await request(app).delete('/settings/image-cache').set(asUser(admin));
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.removed).toBeGreaterThanOrEqual(1);
    expect(cleared.body.data.usage).toEqual({ bytes: 0, count: 0 });
    expect(fs.existsSync(sizedPath(`media/${CATEGORY}`, 'big.jpg', 800))).toBe(false);
  });
});
