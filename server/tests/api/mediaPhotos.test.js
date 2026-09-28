import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember, createReservation, createTour } from '../helpers/factories.js';
import Tour from '../../src/models/tourModel.js';
import config from '../../src/config.js';
import sendResendEmail from '../../src/utils/resendEmail.js';
import { romanToInt, findFolderForOrder } from '../../src/photos/tourFolders.js';
import { byTakenAt, thumbRelPath } from '../../src/photos/imageFiles.js';
import { diffTourImages, listTourPhotoFiles } from '../../src/photos/tourPhotoSync.js';

// "Új média felfedezése": tour albums (with their "mobil" phone photos) and
// the Média photo categories, from folders in the test's temporary area
// (see setup.js's PHOTOS_ROOT / MEDIA_PHOTOS_ROOT / THUMBNAILS_ROOT).
const photosRoot = process.env.PHOTOS_ROOT;
const mediaRoot = process.env.MEDIA_PHOTOS_ROOT;
const thumbsRoot = process.env.THUMBNAILS_ROOT;

// A real (tiny) JPEG, so the real thumbnail code runs on it.
async function putJpeg(file, width = 60, height = 40) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: '#4a8' } })
    .jpeg()
    .toFile(file);
}

const TOUR_FOLDER = '2507_csode_bodorgo_xxviii';

beforeAll(async () => {
  await putJpeg(path.join(photosRoot, TOUR_FOLDER, 'dslr_001.jpg'), 80, 60);
  await putJpeg(path.join(photosRoot, TOUR_FOLDER, 'dslr_002.jpg'));
  await putJpeg(path.join(photosRoot, TOUR_FOLDER, 'mobil', 'IMG_1.jpg'), 40, 80);
  await putJpeg(path.join(photosRoot, TOUR_FOLDER, 'egyeb', 'x.jpg'));
  fs.writeFileSync(path.join(photosRoot, TOUR_FOLDER, 'Thumbs.db'), 'x');
  await putJpeg(path.join(mediaRoot, 'sinners', 'agnes.jpg'));
  await putJpeg(path.join(mediaRoot, 'sinners', 'beni.jpg'));
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
  return (await request(app).get('/media/discover').set(asUser(admin))).body.data;
}

describe('photo helpers', () => {
  it('reads the tour number from the folder name', () => {
    expect(romanToInt('xxviii')).toBe(28);
    expect(romanToInt('xiv')).toBe(14);
    expect(findFolderForOrder(28, photosRoot)).toBe(TOUR_FOLDER);
    expect(findFolderForOrder(99, photosRoot)).toBeNull();
  });

  it("puts a phone photo's thumbnail in the same subfolder", () => {
    expect(thumbRelPath('a.jpg')).toBe('a.webp');
    expect(thumbRelPath('mobil/IMG_1.jpg').replace(/\\/g, '/')).toBe('mobil/IMG_1.webp');
  });

  it('orders by the time taken, undated ones last, then by name', () => {
    const photos = [
      { filename: 'c.jpg', takenAt: null },
      { filename: 'b.jpg', takenAt: '2025-07-03T12:00:00Z' },
      { filename: 'a.jpg', takenAt: '2025-07-03T10:00:00Z' },
      { filename: 'd.jpg' },
    ];
    expect(photos.sort(byTakenAt).map((p) => p.filename)).toEqual([
      'a.jpg',
      'b.jpg',
      'c.jpg',
      'd.jpg',
    ]);
  });

  it('reads the folder and its "mobil" subfolder, reporting the others', () => {
    const { files, skipped } = listTourPhotoFiles(path.join(photosRoot, TOUR_FOLDER));
    expect(files.sort()).toEqual(['dslr_001.jpg', 'dslr_002.jpg', 'mobil/IMG_1.jpg']);
    expect(skipped).toEqual(['egyeb (1)']);
  });

  it('knows what is new and what is gone', () => {
    const { newFilenames, removedImages } = diffTourImages(
      ['a.jpg', 'b.jpg'],
      [{ filename: 'b.jpg' }, { filename: 'gone.jpg' }],
    );
    expect(newFilenames).toEqual(['a.jpg']);
    expect(removedImages.map((i) => i.filename)).toEqual(['gone.jpg']);
  });
});

describe('Új média felfedezése', () => {
  it('is for admins only', async () => {
    const member = await createMember();
    expect((await request(app).post('/media/discover').set(asUser(member))).status).toBe(403);
    expect((await request(app).get('/media/discover').set(asUser(member))).status).toBe(403);
  });

  it('links the new tour folder, syncs its album with the phone photos, and the Média photos', async () => {
    const admin = await createAdmin();
    const tour = await createTour({ order: 28 });

    const result = await discover(admin);
    expect(result.error).toBeUndefined();
    expect(result.report.matched.some((m) => m.includes(TOUR_FOLDER))).toBe(true);

    const saved = await Tour.findById(tour._id).select('+images +sourceFolder');
    expect(saved.sourceFolder).toBe(TOUR_FOLDER);
    expect(saved.images.map((i) => i.filename).sort()).toEqual([
      'dslr_001.jpg',
      'dslr_002.jpg',
      'mobil/IMG_1.jpg',
    ]);
    const phone = saved.images.find((i) => i.filename === 'mobil/IMG_1.jpg');
    expect(phone.source).toBe('mobile');
    expect([phone.width, phone.height]).toEqual([40, 80]);
    expect(saved.images.find((i) => i.filename === 'dslr_001.jpg').source).toBeUndefined();
    expect(fs.existsSync(path.join(thumbsRoot, TOUR_FOLDER, 'mobil', 'IMG_1.webp'))).toBe(true);

    // The phone photo's thumbnail and original, through the tour's image routes.
    const member = await createMember();
    const encoded = encodeURIComponent('mobil/IMG_1.jpg');
    const thumb = await request(app)
      .get(`/tours/${tour._id}/images/${encoded}/thumb`)
      .set(asUser(member));
    expect(thumb.status).toBe(200);
    expect(thumb.headers['content-type']).toContain('image/webp');
    const download = await request(app)
      .get(`/tours/${tour._id}/images/${encoded}/download`)
      .set(asUser(member));
    expect(download.headers['content-disposition']).toContain('IMG_1.jpg');
    expect(download.headers['content-disposition']).not.toContain('mobil');

    // Média → Fotók: the folder is the category.
    const list = await request(app).get('/media/photos').set(asUser(member));
    expect(list.status).toBe(200);
    const sinners = list.body.data.categories.find((c) => c.key === 'sinners');
    expect(sinners.title).toBe('Sinners');
    expect(sinners.photos.map((p) => p.filename).sort()).toEqual(['agnes.jpg', 'beni.jpg']);
    const mediaThumb = await request(app)
      .get('/media/photos/sinners/agnes.jpg/thumb')
      .set(asUser(member));
    expect(mediaThumb.headers['content-type']).toContain('image/webp');
    expect(
      (await request(app).get('/media/photos/sinners/agnes.jpg').set(asUser(member))).status,
    ).toBe(200);
    const mediaDownload = await request(app)
      .get('/media/photos/sinners/agnes.jpg/download')
      .set(asUser(member));
    expect(mediaDownload.status).toBe(200);
    expect(mediaDownload.headers['content-disposition']).toContain('attachment');
    expect(mediaDownload.headers['content-disposition']).toContain('agnes.jpg');
  });

  it('follows deletions, and never serves anything not recorded', async () => {
    const admin = await createAdmin();
    await putJpeg(path.join(mediaRoot, 'sinners', 'temp.jpg'));
    await discover(admin);
    fs.rmSync(path.join(mediaRoot, 'sinners', 'temp.jpg'));
    await discover(admin);

    const member = await createMember();
    const list = await request(app).get('/media/photos').set(asUser(member));
    const sinners = list.body.data.categories.find((c) => c.key === 'sinners');
    expect(sinners.photos.map((p) => p.filename)).not.toContain('temp.jpg');
    expect(
      (await request(app).get('/media/photos/sinners/temp.jpg').set(asUser(member))).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`/media/photos/sinners/${encodeURIComponent('../x.jpg')}`)
          .set(asUser(member))
      ).status,
    ).toBe(404);
    expect(
      (await request(app).get('/media/photos/sinners/temp.jpg/download').set(asUser(member)))
        .status,
    ).toBe(404);
  });

  it('Média photos are for members only', async () => {
    expect((await request(app).get('/media/photos')).status).toBe(401);
  });
});

describe('Új média felfedezése announces new tour recap videos', () => {
  it('e-mails the attendees of a tour whose video just appeared (live server only)', async () => {
    const videosRoot = process.env.VIDEOS_ROOT;
    const file = path.join(videosRoot, 'Season 07 - Proba (2026)', '12 - Proba (2026) S07E01.mp4');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'x');

    // An earlier video was already announced - so this isn't the very first
    // check (which only marks what's there, see tourVideoController.js).
    await createTour({ order: 13, videoNotifiedAt: new Date() });
    const tour = await createTour({ order: 12 });
    const attendee = await createMember({ lastLoginAt: new Date() });
    await createReservation(tour, [attendee]);
    const admin = await createAdmin();

    // A dev server (TOUR_VIDEO_EMAILS off) skips the announcement...
    expect((await discover(admin)).report.videos).toEqual([]);
    expect(sendResendEmail).not.toHaveBeenCalled();

    // ...the live one sends it, once.
    config.tourVideoEmails = true;
    try {
      const report = (await discover(admin)).report;
      expect(report.videos).toEqual([`12. ${tour.title}`]);
      expect(vi.mocked(sendResendEmail).mock.calls[0][0]).toMatchObject({ to: attendee.email });
      expect((await discover(admin)).report.videos).toEqual([]);
    } finally {
      config.tourVideoEmails = false;
    }
  });
});
