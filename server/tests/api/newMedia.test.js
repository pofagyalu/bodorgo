import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember, createTour } from '../helpers/factories.js';
import Tour from '../../src/models/tourModel.js';
import MediaPhoto from '../../src/models/mediaPhotoModel.js';
import VideoSeen from '../../src/models/videoSeenModel.js';
import { NEW_MEDIA_DAYS } from '../../src/utils/newMedia.js';

// "Új" on what an Új média felfedezése has brought (utils/newMedia.js): on
// the photos and videos of Média and of a tour, for the admins only, for
// two weeks. The folders are the test's temporary ones (see setup.js).
const photosRoot = process.env.PHOTOS_ROOT;
const mediaPhotosRoot = process.env.MEDIA_PHOTOS_ROOT;
const tourVideosRoot = process.env.VIDEOS_ROOT;
const mediaVideosRoot = process.env.MEDIA_VIDEOS_ROOT;

const TOUR_FOLDER = '2507_csode_bodorgo_xxviii';
const TOUR_ORDER = 28;

async function putJpeg(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp({ create: { width: 60, height: 40, channels: 3, background: '#4a8' } })
    .jpeg()
    .toFile(file);
}
const putVideo = (root, rel) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), 'x');
};

beforeAll(async () => {
  await putJpeg(path.join(photosRoot, TOUR_FOLDER, 'dslr_001.jpg'));
  await putJpeg(path.join(mediaPhotosRoot, 'sinners', 'agnes.jpg'));
  putVideo(tourVideosRoot, 'Season 12/28 - Csöde (2025) S12E01.mp4');
  putVideo(mediaVideosRoot, 'farsang/Season 01/Farsang (2024) S01E01.mp4');
});

// Starts discovery and waits for it to finish.
async function discover(admin) {
  const start = await request(app).post('/media/discover').set(asUser(admin));
  expect(start.status).toBe(202);
  await vi.waitFor(
    async () => {
      const res = await request(app).get('/media/discover').set(asUser(admin));
      expect(res.body.data.running).toBe(false);
    },
    { timeout: 15000, interval: 100 },
  );
  const { data } = (await request(app).get('/media/discover').set(asUser(admin))).body;
  expect(data.error).toBeUndefined();
  return data;
}

const longAgo = () => new Date(Date.now() - (NEW_MEDIA_DAYS + 1) * 24 * 60 * 60 * 1000);

const mediaPhotos = async (user) =>
  (await request(app).get('/media/photos').set(asUser(user))).body.data.categories.flatMap(
    (c) => c.photos,
  );
const tourPhotos = async (user, tour) =>
  (await request(app).get(`/tours/${tour._id}/images`).set(asUser(user))).body.data.images;
const mediaVideos = async (user) =>
  (await request(app).get('/media/videos').set(asUser(user))).body.data.categories.flatMap(
    (c) => c.videos,
  );
const tourVideos = async (user, tour) =>
  (await request(app).get(`/tours/${tour._id}`).set(asUser(user))).body.data.videos;

describe('"Új" on newly discovered photos', () => {
  it('marks what a discovery added, for the admins only, for two weeks', async () => {
    const admin = await createAdmin();
    const member = await createMember();
    const tour = await createTour({ order: TOUR_ORDER });
    await discover(admin);

    expect(await mediaPhotos(admin)).toEqual([expect.objectContaining({ isNew: true })]);
    expect(await tourPhotos(admin, tour)).toEqual([expect.objectContaining({ isNew: true })]);

    // A member gets no mark - and nobody the time itself.
    for (const photo of [...(await mediaPhotos(member)), ...(await tourPhotos(member, tour))]) {
      expect(photo.isNew).toBeUndefined();
    }
    for (const photo of [...(await mediaPhotos(admin)), ...(await tourPhotos(admin, tour))]) {
      expect(photo.addedAt).toBeUndefined();
    }

    // Two weeks on, the mark is gone.
    await MediaPhoto.updateMany({}, { addedAt: longAgo() });
    await Tour.updateOne({ _id: tour._id }, { $set: { 'images.$[].addedAt': longAgo() } });
    expect((await mediaPhotos(admin))[0].isNew).toBeUndefined();
    expect((await tourPhotos(admin, tour))[0].isNew).toBeUndefined();
  });

  it('leaves a photo recorded before the mark existed unmarked', async () => {
    const admin = await createAdmin();
    await MediaPhoto.create({ category: 'sinners', filename: 'agnes.jpg', width: 60, height: 40 });
    await discover(admin);
    expect((await mediaPhotos(admin))[0].isNew).toBeUndefined();
  });
});

describe('"Új" on newly discovered videos', () => {
  it('the first run only takes stock; a video met later is new for the admins', async () => {
    const admin = await createAdmin();
    const member = await createMember();
    const tour = await createTour({ order: TOUR_ORDER });

    // First run ever: everything was already there - nothing is new.
    expect((await discover(admin)).report.newVideos).toBe(0);
    expect((await mediaVideos(admin)).some((v) => v.isNew)).toBe(false);
    expect((await tourVideos(admin, tour)).some((v) => v.isNew)).toBe(false);

    // One more of each appears, and the button is pressed again.
    putVideo(tourVideosRoot, 'Season 12/28 - Csöde (2025) - Directors Cut - S12E01.mp4');
    putVideo(mediaVideosRoot, 'farsang/Season 01/Farsang (2025) S01E02.mp4');
    expect((await discover(admin)).report.newVideos).toBe(2);

    expect((await mediaVideos(admin)).map((v) => [v.year, !!v.isNew])).toEqual([
      [2025, true],
      [2024, false],
    ]);
    expect((await tourVideos(admin, tour)).map((v) => [v.label, !!v.isNew])).toEqual([
      ['', false],
      ['Rendezői változat', true],
    ]);
    expect((await mediaVideos(member)).some((v) => v.isNew)).toBe(false);
    expect((await tourVideos(member, tour)).some((v) => v.isNew)).toBe(false);

    // Pressed again: the same files are not counted twice.
    expect((await discover(admin)).report.newVideos).toBe(0);
    expect((await mediaVideos(admin)).filter((v) => v.isNew)).toHaveLength(1);

    // Two weeks on, the mark is gone.
    await VideoSeen.updateMany({ seenAt: { $ne: null } }, { seenAt: longAgo() });
    expect((await mediaVideos(admin)).some((v) => v.isNew)).toBe(false);
    expect((await tourVideos(admin, tour)).some((v) => v.isNew)).toBe(false);
  });
});
