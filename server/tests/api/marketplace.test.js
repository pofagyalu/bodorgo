import fs from 'fs';
import sharp from 'sharp';
import webpush from 'web-push';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createGuest, createMember } from '../helpers/factories.js';
import MarketItem from '../../src/models/marketItemModel.js';
import User from '../../src/models/userModel.js';
import { marketPhotoPath, marketThumbPath } from '../../src/marketplace/marketPhotos.js';

// Ócskapiac: offering things with up to 3 photos (made WebP), Kérem!,
// Stipistopi! held for 7 days, one-line notes, Odaadtam.

const phonePhoto = () =>
  sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#a85' } })
    .jpeg()
    .withExif({ IFD0: { Make: 'TestPhone' }, IFD3: { GPSLatitudeRef: 'N' } })
    .toBuffer();

async function offer(user, { fields = {}, photos = 1 } = {}) {
  const req = request(app).post('/ocskapiac').set(asUser(user));
  const all = { title: 'Csavarok', priceKind: 'sor', priceAmount: '2', ...fields };
  for (const [k, v] of Object.entries(all)) req.field(k, v);
  for (let i = 0; i < photos; i++) {
    req.attach('photos', await phonePhoto(), { filename: `p${i}.jpg`, contentType: 'image/jpeg' });
  }
  return req;
}

const as = (user) => ({
  get: (url) => request(app).get(url).set(asUser(user)),
  post: (url, body) =>
    request(app)
      .post(url)
      .set(asUser(user))
      .send(body ?? {}),
  del: (url) => request(app).delete(url).set(asUser(user)),
});

describe('Ócskapiac', () => {
  it('a guest offers something: photos become WebP (1600 px + thumb, no EXIF)', async () => {
    const guest = await createGuest();
    const res = await offer(guest, {
      fields: { title: 'Gyerekcipő 28', category: 'gyerek', description: 'Alig hordott' },
      photos: 2,
    });
    expect(res.status).toBe(201);
    const { item } = res.body.data;
    expect(item).toMatchObject({
      title: 'Gyerekcipő 28',
      category: 'gyerek',
      price: { kind: 'sor', amount: 2 },
      status: 'available',
      mine: true,
    });
    expect(item.photos).toHaveLength(2);
    expect(item.photos[0]).toMatchObject({ width: 1600, height: 1067 });

    const meta = await sharp(fs.readFileSync(marketPhotoPath(item.photos[0]._id))).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    const thumb = await sharp(fs.readFileSync(marketThumbPath(item.photos[0]._id))).metadata();
    expect(thumb.width).toBe(480);

    const url = `/ocskapiac/${item._id}/photos/${item.photos[0]._id}`;
    const other = await createMember();
    const got = await as(other).get(url);
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toContain('image/webp');
    expect((await as(other).get(`${url}/thumb`)).status).toBe(200);
    expect((await request(app).get(url)).status).toBe(401);

    const list = await as(other).get('/ocskapiac');
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0]).toMatchObject({ mine: false, owner: { name: guest.name } });
  });

  it('refuses: no photo, more than 3, not an image, a bad price, no title', async () => {
    const member = await createMember();
    expect((await offer(member, { photos: 0 })).status).toBe(400);
    expect((await offer(member, { photos: 4 })).status).toBe(400);
    const notImage = await request(app)
      .post('/ocskapiac')
      .set(asUser(member))
      .field('title', 'x')
      .attach('photos', Buffer.from('fake'), { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(notImage.status).toBe(400);
    expect((await offer(member, { fields: { priceAmount: '0' } })).status).toBe(400);
    expect(
      (await offer(member, { fields: { priceKind: 'forint', priceAmount: '1500' } })).status,
    ).toBe(201);
    expect((await offer(member, { fields: { title: '  ' } })).status).toBe(400);
    expect(await MarketItem.countDocuments()).toBe(1);
    // A free one needs no amount.
    const free = await offer(member, { fields: { priceKind: 'ingyen', priceAmount: '' } });
    expect(free.body.data.item.price).toEqual({ kind: 'ingyen', amount: null });
  });

  it('Kérem!: anyone but the owner, once each; the owner sees who', async () => {
    const owner = await createMember();
    const { item } = (await offer(owner)).body.data;
    const a = await createMember();
    const b = await createGuest();
    expect((await as(owner).post(`/ocskapiac/${item._id}/want`)).status).toBe(400);
    await as(a).post(`/ocskapiac/${item._id}/want`);
    await as(a).post(`/ocskapiac/${item._id}/want`);
    const res = await as(b).post(`/ocskapiac/${item._id}/want`);
    expect(res.body.data.item.iWant).toBe(true);
    const seen = (await as(owner).get(`/ocskapiac/${item._id}`)).body.data.item;
    expect(seen.wanted.map((w) => w.user.name)).toEqual([a.name, b.name]);
    const back = await as(a).del(`/ocskapiac/${item._id}/want`);
    expect(back.body.data.item.wanted).toHaveLength(1);
    expect(back.body.data.item.iWant).toBe(false);
  });

  it('Stipistopi!: one holder for 7 days, then free for anyone again', async () => {
    const owner = await createMember();
    const { item } = (await offer(owner)).body.data;
    const a = await createMember();
    const b = await createMember();
    expect((await as(owner).post(`/ocskapiac/${item._id}/dibs`)).status).toBe(400);
    const held = await as(a).post(`/ocskapiac/${item._id}/dibs`);
    expect(held.body.data.item).toMatchObject({ status: 'reserved', iReserved: true });
    expect(held.body.data.item.reservedBy.name).toBe(a.name);
    expect((await as(b).post(`/ocskapiac/${item._id}/dibs`)).status).toBe(409);
    expect((await as(b).del(`/ocskapiac/${item._id}/dibs`)).status).toBe(400);

    // 8 days later: free again, b may take it.
    await MarketItem.updateOne(
      { _id: item._id },
      { reservedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
    );
    const later = (await as(b).get(`/ocskapiac/${item._id}`)).body.data.item;
    expect(later).toMatchObject({ status: 'available', reservedBy: null, reservedUntil: null });
    const taken = await as(b).post(`/ocskapiac/${item._id}/dibs`);
    expect(taken.body.data.item.reservedBy.name).toBe(b.name);

    // "Mégse kell".
    const let_go = await as(b).del(`/ocskapiac/${item._id}/dibs`);
    expect(let_go.body.data.item.status).toBe('available');
  });

  it('notes: a one-liner from anyone, deleted only by its writer', async () => {
    const owner = await createMember();
    const { item } = (await offer(owner)).body.data;
    const a = await createGuest();
    const res = await as(a).post(`/ocskapiac/${item._id}/notes`, { text: 'Hívlak este!' });
    expect(res.status).toBe(201);
    const [note] = res.body.data.item.notes;
    expect(note).toMatchObject({ text: 'Hívlak este!', user: { name: a.name } });
    expect(
      (await as(a).post(`/ocskapiac/${item._id}/notes`, { text: 'x'.repeat(101) })).status,
    ).toBe(400);
    expect((await as(owner).del(`/ocskapiac/${item._id}/notes/${note._id}`)).status).toBe(403);
    const gone = await as(a).del(`/ocskapiac/${item._id}/notes/${note._id}`);
    expect(gone.body.data.item.notes).toHaveLength(0);
  });

  it('the owner changes it: fields, photos off and on (1-3)', async () => {
    const owner = await createMember();
    const { item } = (await offer(owner, { photos: 2 })).body.data;
    const [first, second] = item.photos;
    expect(
      (
        await request(app)
          .patch(`/ocskapiac/${item._id}`)
          .set(asUser(await createMember()))
          .field('title', 'Enyém!')
      ).status,
    ).toBe(403);

    const tooMany = await request(app)
      .patch(`/ocskapiac/${item._id}`)
      .set(asUser(owner))
      .attach('photos', await phonePhoto(), { filename: 'a.jpg', contentType: 'image/jpeg' })
      .attach('photos', await phonePhoto(), { filename: 'b.jpg', contentType: 'image/jpeg' });
    expect(tooMany.status).toBe(400);

    const res = await request(app)
      .patch(`/ocskapiac/${item._id}`)
      .set(asUser(owner))
      .field('title', 'Csavarok, sok')
      .field('priceKind', 'ingyen')
      .field('removePhotos', String(first._id))
      .attach('photos', await phonePhoto(), { filename: 'c.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    const changed = res.body.data.item;
    expect(changed).toMatchObject({ title: 'Csavarok, sok', price: { kind: 'ingyen' } });
    expect(changed.photos).toHaveLength(2);
    expect(changed.photos[0]._id).toBe(second._id);
    expect(fs.existsSync(marketPhotoPath(first._id))).toBe(false);

    const none = await request(app)
      .patch(`/ocskapiac/${item._id}`)
      .set(asUser(owner))
      .field('removePhotos', changed.photos[0]._id)
      .field('removePhotos', changed.photos[1]._id);
    expect(none.status).toBe(400);
  });

  it('an SVG sent past the app (straight to the API) is refused - on a new item and an old one', async () => {
    // The app itself only ever sends a JPEG it drew (shared/image-resize.ts):
    // this is someone calling the server directly.
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );
    const owner = await createMember();
    const created = await request(app)
      .post('/ocskapiac')
      .set(asUser(owner))
      .field('title', 'Bögre')
      .field('priceKind', 'ingyen')
      .attach('photos', svg, { filename: 'a.svg', contentType: 'image/svg+xml' });
    expect(created.status).toBe(400);

    const { item } = (await offer(owner)).body.data;
    const changed = await request(app)
      .patch(`/ocskapiac/${item._id}`)
      .set(asUser(owner))
      .attach('photos', svg, { filename: 'b.jpg', contentType: 'image/jpeg' });
    expect(changed.status).toBe(400);
    expect((await MarketItem.findById(item._id)).photos).toHaveLength(1);
  });

  it('Odaadtam: kept for good, photos and all; nothing more can be asked', async () => {
    const owner = await createMember();
    const { item } = (await offer(owner)).body.data;
    const photo = item.photos[0];
    const a = await createMember();
    expect((await as(a).post(`/ocskapiac/${item._id}/gone`)).status).toBe(403);
    const res = await as(owner).post(`/ocskapiac/${item._id}/gone`);
    expect(res.body.data.item).toMatchObject({ status: 'gone' });
    expect(res.body.data.item.photos).toHaveLength(1);
    expect((await as(a).get(`/ocskapiac/${item._id}/photos/${photo._id}`)).status).toBe(200);
    expect((await as(a).post(`/ocskapiac/${item._id}/want`)).status).toBe(400);
    expect((await as(a).post(`/ocskapiac/${item._id}/dibs`)).status).toBe(400);
    expect((await as(owner).post(`/ocskapiac/${item._id}/gone`)).status).toBe(400);

    // A year later it's still there.
    await MarketItem.updateOne(
      { _id: item._id },
      { goneAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) },
    );
    const list = (await as(a).get('/ocskapiac')).body.data.items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: 'gone' });
    expect(fs.existsSync(marketPhotoPath(photo._id))).toBe(true);
  });

  it('deleting: an admin for real; its owner only hides it (kept, photos too)', async () => {
    const owner = await createMember();
    const { item } = (await offer(owner)).body.data;
    expect((await as(await createMember()).del(`/ocskapiac/${item._id}`)).status).toBe(403);
    expect((await as(await createAdmin()).del(`/ocskapiac/${item._id}`)).status).toBe(204);
    expect(fs.existsSync(marketPhotoPath(item.photos[0]._id))).toBe(false);
    expect(await MarketItem.countDocuments()).toBe(0);

    const mine = (await offer(owner)).body.data.item;
    const photo = mine.photos[0];
    expect((await as(owner).del(`/ocskapiac/${mine._id}`)).status).toBe(204);
    const kept = await MarketItem.findById(mine._id);
    expect(kept.deletedAt).toBeInstanceOf(Date);
    expect(fs.existsSync(marketPhotoPath(photo._id))).toBe(true);
    // Nobody sees it any more - not its owner, not an admin.
    const admin = await createAdmin();
    expect((await as(owner).get('/ocskapiac')).body.data.items).toHaveLength(0);
    expect((await as(admin).get(`/ocskapiac/${mine._id}`)).status).toBe(404);
    expect((await as(owner).get(`/ocskapiac/${mine._id}/photos/${photo._id}`)).status).toBe(404);
    expect((await as(owner).del(`/ocskapiac/${mine._id}`)).status).toBe(404);
  });
});

describe('Ócskapiac: telling people about something new', () => {
  const subscribe = (user) =>
    request(app)
      .post('/push/subscriptions')
      .set(asUser(user))
      .send({ endpoint: `https://push.test/${user._id}`, keys: { p256dh: 'p', auth: 'a' } });
  const pushedTo = () =>
    vi
      .mocked(webpush.sendNotification)
      .mock.calls.map(([sub, body]) => [sub.endpoint, JSON.parse(body)]);

  it('a new item: a push to everyone but its owner and those who turned it off', async () => {
    const owner = await createMember({ name: 'Anna Kovács', username: 'anna' });
    const guest = await createGuest();
    const member = await createMember();
    const quiet = await createMember();
    for (const u of [owner, guest, member, quiet]) await subscribe(u);
    const off = await request(app)
      .patch('/users/updateMe')
      .set(asUser(quiet))
      .send({ wantsMarketPush: false });
    expect(off.status).toBe(200);
    expect((await User.findById(quiet._id)).wantsMarketPush).toBe(false);
    expect((await as(quiet).get('/users/me')).body.data.wantsMarketPush).toBe(false);
    vi.mocked(webpush.sendNotification).mockClear();

    const { item } = (await offer(owner, { fields: { title: 'Lámpa' } })).body.data;
    await vi.waitFor(() => expect(pushedTo()).toHaveLength(2));
    expect(
      pushedTo()
        .map(([endpoint]) => endpoint)
        .sort(),
    ).toEqual([`https://push.test/${guest._id}`, `https://push.test/${member._id}`].sort());
    expect(pushedTo()[0][1]).toMatchObject({
      title: '🧺 Új kacat az Ócskapiacon',
      body: 'anna: Lámpa · 🍺 2 sör',
      tag: 'ocskapiac-uj',
      url: `/ocskapiac?kacat=${item._id}`,
    });
  });

  it('the badge: what others put up since I last opened it', async () => {
    const me = await createMember();
    const other = await createMember();
    const count = async () => (await as(me).get('/ocskapiac/new-count')).body.data.count;
    await offer(other);
    await offer(me);
    // Never opened: everything of others' still on offer.
    expect(await count()).toBe(1);
    await as(me).get('/ocskapiac');
    expect(await count()).toBe(0);
    const { item } = (await offer(other)).body.data;
    expect(await count()).toBe(1);
    // A hidden (deleted) or gone one doesn't count.
    await as(other).del(`/ocskapiac/${item._id}`);
    expect(await count()).toBe(0);
  });
});
