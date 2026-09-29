import fs from 'fs';
import sharp from 'sharp';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember, createTour } from '../helpers/factories.js';
import Post from '../../src/models/postModel.js';
import ClubSettings from '../../src/models/clubSettingsModel.js';
import { chatImagePath, enforceChatImageQuota } from '../../src/chat/chatImages.js';
import { tourChatRoom } from '../../src/chat/chatRooms.js';

// Photos in the chats: shrunk, stripped of their location, limited per
// day, and kept under the quota - the oldest going first.

// A big "phone photo" (3000x2000) carrying a GPS location in its EXIF.
const phonePhoto = () =>
  sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#5a8' } })
    .jpeg()
    .withExif({ IFD0: { Make: 'TestPhone' }, IFD3: { GPSLatitudeRef: 'N' } })
    .toBuffer();

const send = async (user, room, { buffer, text = '', type = 'image/jpeg' } = {}) =>
  request(app)
    .post(`/chat-rooms/${room._id}/images`)
    .set(asUser(user))
    .field('text', text)
    .attach('image', buffer ?? (await phonePhoto()), { filename: 'x.jpg', contentType: type });

describe('chat photos', () => {
  it('shrinks the photo to 1600 px, drops its EXIF (GPS), and serves it to logged-in users', async () => {
    const member = await createMember();
    const room = await tourChatRoom((await createTour())._id);
    const res = await send(member, room, { text: 'Nézzétek!' });
    expect(res.status).toBe(201);
    const { post } = res.body.data;
    expect(post).toMatchObject({ text: 'Nézzétek!', image: { width: 1600, height: 1067 } });

    const meta = await sharp(fs.readFileSync(chatImagePath(post._id))).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(1600);
    expect(meta.exif).toBeUndefined();

    const url = `/chat-rooms/${room._id}/images/${post._id}`;
    const full = await request(app)
      .get(url)
      .set(asUser(await createMember()));
    expect(full.status).toBe(200);
    expect(full.headers['content-type']).toContain('image/webp');
    const thumb = await request(app).get(`${url}/thumb`).set(asUser(member));
    expect(thumb.headers['content-type']).toContain('image/webp');
    expect((await request(app).get(url)).status).toBe(401);
  });

  it('refuses a file that is not an image', async () => {
    const member = await createMember();
    const room = await tourChatRoom((await createTour())._id);
    const res = await send(member, room, {
      buffer: Buffer.from('not an image'),
      type: 'text/plain',
    });
    expect(res.status).toBe(400);
    const fake = await send(member, room, { buffer: Buffer.from('fake'), type: 'image/jpeg' });
    expect(fake.status).toBe(400);
    expect(await Post.countDocuments()).toBe(0);
  });

  it('keeps to the daily limit per person', async () => {
    await ClubSettings.findOneAndUpdate(
      { key: 'club' },
      { chatImages: { quotaMB: 1024, dailyLimit: 2 } },
      { upsert: true },
    );
    const member = await createMember();
    const room = await tourChatRoom((await createTour())._id);
    expect((await send(member, room)).status).toBe(201);
    expect((await send(member, room)).status).toBe(201);
    const third = await send(member, room);
    expect(third.status).toBe(429);
    expect(third.body.message).toContain('holnap');
    // Somebody else still can.
    expect((await send(await createMember(), room)).status).toBe(201);
  });

  it('over the quota the oldest photos go - their messages stay', async () => {
    const member = await createMember();
    const room = await tourChatRoom((await createTour())._id);
    const first = (await send(member, room)).body.data.post;
    const second = (await send(member, room)).body.data.post;
    const third = (await send(member, room)).body.data.post;
    // Pretend they're big: 30 MB each against a 50 MB quota.
    await Post.updateMany({}, { 'image.size': 30 * 1024 * 1024 });
    await ClubSettings.findOneAndUpdate(
      { key: 'club' },
      { chatImages: { quotaMB: 50, dailyLimit: 10 } },
      { upsert: true },
    );

    expect(await enforceChatImageQuota()).toBe(2);
    const expired = (id) => Post.findById(id).then((p) => p.image.expired);
    expect(await expired(first._id)).toBe(true);
    expect(await expired(second._id)).toBe(true);
    expect(await expired(third._id)).toBe(false);
    expect(fs.existsSync(chatImagePath(first._id))).toBe(false);
    const gone = await request(app)
      .get(`/chat-rooms/${room._id}/images/${first._id}`)
      .set(asUser(member));
    expect(gone.status).toBe(404);
  });
});

describe('chat photo settings (Beállítások)', () => {
  it('admins only; validated; shows the usage', async () => {
    const member = await createMember();
    expect((await request(app).get('/settings/chat-images').set(asUser(member))).status).toBe(403);
    const admin = await createAdmin();
    const get = await request(app).get('/settings/chat-images').set(asUser(admin));
    expect(get.body.data).toMatchObject({ quotaMB: 1024, dailyLimit: 10, usage: { bytes: 0 } });
    const put = (body) => request(app).put('/settings/chat-images').set(asUser(admin)).send(body);
    expect((await put({ quotaMB: 10, dailyLimit: 5 })).status).toBe(400);
    expect((await put({ quotaMB: 2048, dailyLimit: 0 })).status).toBe(400);
    const ok = await put({ quotaMB: 2048, dailyLimit: 20 });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ quotaMB: 2048, dailyLimit: 20 });
  });
});
