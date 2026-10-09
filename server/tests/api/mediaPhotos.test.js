import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember, createReservation, createTour } from '../helpers/factories.js';
import Tour from '../../src/models/tourModel.js';
import MediaPhoto from '../../src/models/mediaPhotoModel.js';
import MediaPhotoSettings from '../../src/models/mediaPhotoSettingsModel.js';
import MediaPhotoFolder from '../../src/models/mediaPhotoFolderModel.js';
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
  // A category with albums: the folders inside it - one level only.
  await putJpeg(path.join(mediaRoot, 'farsangok', '2019', 'a.jpg'));
  await putJpeg(path.join(mediaRoot, 'farsangok', '2020', 'b.jpg'));
  await putJpeg(path.join(mediaRoot, 'farsangok', '2020', 'c.jpg'));
  await putJpeg(path.join(mediaRoot, 'farsangok', '2020', 'mely', 'd.jpg'));
  await putJpeg(path.join(mediaRoot, 'farsangok', '@eaDir', 'x.jpg'));
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

describe('Média photos: a name and viewers', () => {
  const sinners = async (user) =>
    (await request(app).get('/media/photos').set(asUser(user))).body.data.categories.find(
      (c) => c.key === 'sinners',
    );
  const patch = (user, body, filename = 'agnes.jpg') =>
    request(app).patch(`/media/photos/sinners/${filename}`).set(asUser(user)).send(body);
  const get = (user, tail = '', filename = 'agnes.jpg') =>
    request(app).get(`/media/photos/sinners/${filename}${tail}`).set(asUser(user));

  it('the role manager names a photo and says who may see it, one photo at a time', async () => {
    for (const filename of ['agnes.jpg', 'beni.jpg']) {
      await MediaPhoto.findOneAndUpdate(
        { category: 'sinners', filename },
        { width: 60, height: 40 },
        { upsert: true },
      );
    }
    // Only the role manager edits a photo - no other admin.
    const admin = await createAdmin({ canManageRoles: true });
    const otherAdmin = await createAdmin();
    const chosen = await createMember();
    const other = await createMember();
    const names = (category) => category.photos.map((p) => p.filename).sort();
    const agnes = (category) => category.photos.find((p) => p.filename === 'agnes.jpg');

    expect((await patch(other, { title: 'x' })).status).toBe(403);
    expect((await patch(otherAdmin, { title: 'x' })).status).toBe(403);
    expect((await patch(admin, { title: 'x' }, 'nincs.jpg')).status).toBe(404);
    expect((await patch(admin, { viewers: ['64b000000000000000000000'] })).status).toBe(400);
    // No name until one is given - the file's is not one.
    expect(agnes(await sinners(admin))).toMatchObject({ title: null, viewers: [] });

    const res = await patch(admin, { title: 'Ágnes', viewers: [String(chosen._id)] });
    expect(res.body.data.photo).toEqual({
      filename: 'agnes.jpg',
      title: 'Ágnes',
      viewers: [String(chosen._id)],
    });

    // Only the role manager is told who the viewers are; any admin sees it.
    expect(agnes(await sinners(admin)).viewers).toEqual([String(chosen._id)]);
    expect(agnes(await sinners(otherAdmin)).title).toBe('Ágnes');
    expect(agnes(await sinners(otherAdmin)).viewers).toBeUndefined();
    expect(agnes(await sinners(chosen))).toMatchObject({ title: 'Ágnes' });
    expect(agnes(await sinners(chosen)).viewers).toBeUndefined();
    // The other photo of the folder stays everyone's.
    expect(names(await sinners(other))).toEqual(['beni.jpg']);
    expect((await get(other, '', 'beni.jpg')).status).toBe(200);

    for (const tail of ['', '/thumb', '/download']) {
      expect((await get(chosen, tail)).status).toBe(200);
      expect((await get(admin, tail)).status).toBe(200);
      expect((await get(other, tail)).status).toBe(404);
    }

    // A folder with nothing left to show is left out.
    await patch(admin, { viewers: [String(chosen._id)] }, 'beni.jpg');
    expect(await sinners(other)).toBeUndefined();
    await patch(admin, { viewers: [] }, 'beni.jpg');

    // The name is taken away, the viewers stay; then open again.
    expect((await patch(admin, { title: '' })).body.data.photo.title).toBeNull();
    expect(agnes(await sinners(chosen)).title).toBeNull();
    expect(names(await sinners(other))).toEqual(['beni.jpg']);
    await patch(admin, { viewers: [] });
    expect((await get(other)).status).toBe(200);
    expect(await MediaPhotoSettings.countDocuments()).toBe(0);
  });
});

describe('Média photos: albums', () => {
  const farsangok = async (user) =>
    (await request(app).get('/media/photos').set(asUser(user))).body.data.categories.find(
      (c) => c.key === 'farsangok',
    );
  const album = (user, key = '2020') =>
    request(app).get(`/media/photo-albums/farsangok/${key}`).set(asUser(user));
  const patchAlbum = (user, body, key = '2020') =>
    request(app).patch(`/media/photo-albums/farsangok/${key}`).set(asUser(user)).send(body);
  const patchCategory = (user, body, key = 'farsangok') =>
    request(app).patch(`/media/photos/${key}`).set(asUser(user)).send(body);
  const photo = (user, tail = '', filename = '2020/b.jpg') =>
    request(app)
      .get(`/media/photos/farsangok/${encodeURIComponent(filename)}${tail}`)
      .set(asUser(user));

  it('a folder inside a category is an album: a card in the list, its photos on their own', async () => {
    const admin = await createAdmin();
    const member = await createMember();
    await discover(admin);

    const category = await farsangok(member);
    expect(category).toMatchObject({ title: 'Farsangok', photos: [], count: 3 });
    // Newest first; the NAS's own folder and anything deeper are left alone.
    expect(category.albums).toEqual([
      { key: '2020', title: '2020', discoveredTitle: '2020', count: 2, cover: '2020/b.jpg' },
      { key: '2019', title: '2019', discoveredTitle: '2019', count: 1, cover: '2019/a.jpg' },
    ]);
    // An admin: how many of them the discovery has just brought.
    expect((await farsangok(admin)).albums.map((a) => a.newCount)).toEqual([2, 1]);

    const photos = (await album(member)).body.data.photos;
    expect(photos.map((p) => p.filename)).toEqual(['2020/b.jpg', '2020/c.jpg']);
    expect((await album(member, '2018')).status).toBe(404);

    const thumb = await photo(member, '/thumb');
    expect(thumb.headers['content-type']).toContain('image/webp');
    expect(fs.existsSync(path.join(thumbsRoot, '_media', 'farsangok', '2020', 'b.webp'))).toBe(
      true,
    );
    expect((await photo(member)).status).toBe(200);
    const download = await photo(member, '/download');
    expect(download.headers['content-disposition']).toContain('b.jpg');
    expect(download.headers['content-disposition']).not.toContain('2020');
    expect((await photo(member, '', '2020/mely/d.jpg')).status).toBe(404);
  });

  it('the role manager renames an album, picks its cover, and says who may see it', async () => {
    const admin = await createAdmin({ canManageRoles: true });
    const otherAdmin = await createAdmin();
    const chosen = await createMember();
    const other = await createMember();
    await discover(admin);
    const the2020 = async (user) => (await farsangok(user))?.albums.find((a) => a.key === '2020');

    expect((await patchAlbum(other, { title: 'x' })).status).toBe(403);
    expect((await patchAlbum(otherAdmin, { title: 'x' })).status).toBe(403);
    expect((await patchAlbum(admin, { title: 'x' }, '2018')).status).toBe(404);
    expect((await patchAlbum(admin, { cover: '2019/a.jpg' })).status).toBe(400);
    expect((await patchAlbum(admin, { cover: 5 })).status).toBe(400);

    const res = await patchAlbum(admin, { title: 'Hawaii', cover: '2020/c.jpg' });
    expect(res.body.data.album).toEqual({
      key: '2020',
      title: 'Hawaii',
      discoveredTitle: '2020',
      viewers: [],
      cover: '2020/c.jpg',
    });
    expect(await the2020(other)).toMatchObject({ title: 'Hawaii', cover: '2020/c.jpg' });
    expect((await the2020(other)).viewers).toBeUndefined();

    // Only the chosen (and the admins) see it, and anything in it.
    await patchAlbum(admin, { viewers: [String(chosen._id)] });
    expect((await the2020(admin)).viewers).toEqual([String(chosen._id)]);
    expect((await the2020(otherAdmin)).viewers).toBeUndefined();
    expect(await the2020(chosen)).toMatchObject({ title: 'Hawaii', count: 2 });
    expect(await the2020(other)).toBeUndefined();
    expect((await farsangok(other)).count).toBe(1);
    expect((await album(other)).status).toBe(404);
    expect((await album(chosen)).status).toBe(200);
    for (const tail of ['', '/thumb', '/download']) {
      expect((await photo(chosen, tail)).status).toBe(200);
      expect((await photo(otherAdmin, tail)).status).toBe(200);
      expect((await photo(other, tail)).status).toBe(404);
    }
    expect((await photo(other, '', '2019/a.jpg')).status).toBe(200);

    // A cover this user may not see: the first of what they may.
    await patchAlbum(admin, { viewers: [] });
    await request(app)
      .patch(`/media/photos/farsangok/${encodeURIComponent('2020/c.jpg')}`)
      .set(asUser(admin))
      .send({ viewers: [String(chosen._id)] });
    expect(await the2020(other)).toMatchObject({ count: 1, cover: '2020/b.jpg' });
    expect((await the2020(chosen)).cover).toBe('2020/c.jpg');

    // Back to the folder's name and the first photo: nothing left to keep.
    const back = await patchAlbum(admin, { title: '2020', cover: '' });
    expect(back.body.data.album).toMatchObject({ title: '2020', cover: null });
    expect(await MediaPhotoFolder.countDocuments()).toBe(0);
  });

  it('the role manager renames a category, and says who may see all of it', async () => {
    const admin = await createAdmin({ canManageRoles: true });
    const otherAdmin = await createAdmin();
    const chosen = await createMember();
    const other = await createMember();
    await discover(admin);

    expect((await patchCategory(other, { title: 'x' })).status).toBe(403);
    expect((await patchCategory(otherAdmin, { title: 'x' })).status).toBe(403);
    expect((await patchCategory(admin, { title: 'x' }, 'nincs')).status).toBe(404);

    const res = await patchCategory(admin, { title: 'Jelmezbálok', viewers: [String(chosen._id)] });
    expect(res.body.data.category).toEqual({
      key: 'farsangok',
      title: 'Jelmezbálok',
      discoveredTitle: 'Farsangok',
      viewers: [String(chosen._id)],
    });
    expect(await farsangok(admin)).toMatchObject({ viewers: [String(chosen._id)] });
    expect(await farsangok(chosen)).toMatchObject({ title: 'Jelmezbálok', count: 3 });
    expect((await farsangok(chosen)).viewers).toBeUndefined();
    expect((await farsangok(otherAdmin)).count).toBe(3);
    expect(await farsangok(other)).toBeUndefined();
    expect((await album(other)).status).toBe(404);
    expect((await photo(other, '/thumb')).status).toBe(404);
    expect((await photo(chosen, '/thumb')).status).toBe(200);
    // The other categories stay everyone's.
    expect(
      (await request(app).get('/media/photos/sinners/agnes.jpg').set(asUser(other))).status,
    ).toBe(200);

    await patchCategory(admin, { title: '', viewers: [] });
    expect(await farsangok(other)).toMatchObject({ title: 'Farsangok', count: 3 });
    expect(await MediaPhotoFolder.countDocuments()).toBe(0);
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
