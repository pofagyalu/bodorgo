import request from 'supertest';
import webpush from 'web-push';
import { describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createMember, createReservation, createTour } from '../helpers/factories.js';
import PushSubscription from '../../src/models/pushSubscriptionModel.js';
import Post from '../../src/models/postModel.js';
import { markChatRead, notifyChatPost, setChatMuted } from '../../src/chat/chatNotifications.js';

let n = 0;
const subscribeDevice = (user) =>
  request(app)
    .post('/push/subscriptions')
    .set(asUser(user))
    .send({ endpoint: `https://push.test/${++n}`, keys: { p256dh: 'p', auth: 'a' } });

// What each device was sent, in order: [endpoint, payload].
const sentPushes = () =>
  vi
    .mocked(webpush.sendNotification)
    .mock.calls.map(([sub, body]) => [sub.endpoint, JSON.parse(body)]);

// A stand-in for Socket.IO: who has the chat open right now.
const fakeIo = (watching = []) => ({
  in: () => ({
    fetchSockets: async () =>
      watching.map(([userId, tourId]) => ({ data: { userId, visibleTour: tourId } })),
  }),
});

async function post(tour, author, text) {
  const p = await Post.create({ tourId: tour._id, creator: author._id, text });
  return p.populate('creator', 'name username');
}

describe('push subscriptions', () => {
  it('a device turns on, gets a test notification, turns off', async () => {
    const user = await createMember();
    expect((await request(app).get('/push/public-key').set(asUser(user))).body.data.publicKey).toBe(
      'test-public-key',
    );
    expect((await request(app).post('/push/test').set(asUser(user))).status).toBe(400); // no device yet

    expect((await subscribeDevice(user)).status).toBe(201);
    expect((await request(app).post('/push/test').set(asUser(user))).body.data.sent).toBe(1);
    expect(sentPushes()[0][1]).toMatchObject({ title: 'Bódorgó', tag: 'test' });

    const [sub] = await PushSubscription.find({ user: user._id });
    await request(app)
      .delete('/push/subscriptions')
      .set(asUser(user))
      .send({ endpoint: sub.endpoint });
    expect(await PushSubscription.countDocuments()).toBe(0);

    const bad = await request(app)
      .post('/push/subscriptions')
      .set(asUser(user))
      .send({ endpoint: 'http://x' });
    expect(bad.status).toBe(400);
    expect((await request(app).get('/push/public-key')).status).toBe(401);
  });

  it('a device the push service no longer knows is forgotten', async () => {
    const user = await createMember();
    await subscribeDevice(user);
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce(
      Object.assign(new Error('gone'), { statusCode: 410 }),
    );
    await request(app).post('/push/test').set(asUser(user));
    expect(await PushSubscription.countDocuments()).toBe(0);
  });

  it("mutes one tour's chat", async () => {
    const user = await createMember();
    const tour = await createTour();
    const url = `/push/chat-mutes/${tour._id}`;
    expect((await request(app).get(url).set(asUser(user))).body.data.muted).toBe(false);
    await request(app).put(url).set(asUser(user)).send({ muted: true });
    expect((await request(app).get(url).set(asUser(user))).body.data.muted).toBe(true);
  });
});

describe('chat notifications: one buzz, then quiet until read', () => {
  it('buzzes once, then updates silently; reading lets it buzz again; mentions always buzz', async () => {
    const tour = await createTour({ order: 25, title: 'Sarud' });
    const anna = await createMember({ name: 'Anna', username: 'anna' });
    const bela = await createMember({ name: 'Béla', username: 'bela' });
    await createReservation(tour, [anna, bela]);
    await subscribeDevice(bela);

    await notifyChatPost(fakeIo(), await post(tour, anna, 'Holnap 8-kor indulunk'));
    await notifyChatPost(fakeIo(), await post(tour, anna, 'Hozzatok kenyeret is'));
    const [first, second] = sentPushes().map(([, p]) => p);
    expect(first).toMatchObject({
      title: '25. Sarud – chat',
      body: 'anna: Holnap 8-kor indulunk',
      tag: `chat-${tour._id}`,
      silent: false,
      renotify: true,
      url: `/chat?tabor=${tour._id}`,
    });
    // Same notification, updated without a sound.
    expect(second).toMatchObject({
      body: '2 új üzenet · anna: Hozzatok kenyeret is',
      silent: true,
      renotify: false,
    });

    // A mention gets through even while quiet.
    await notifyChatPost(fakeIo(), await post(tour, anna, 'Szia @Bela, hozod a bográcsot?'));
    expect(sentPushes()[2][1]).toMatchObject({ silent: false, renotify: true });

    // Béla opens the chat - the next message buzzes again, counting from there.
    await markChatRead(bela._id, tour._id);
    await notifyChatPost(fakeIo(), await post(tour, anna, 'Megjött a busz'));
    expect(sentPushes()[3][1]).toMatchObject({ body: 'anna: Megjött a busz', silent: false });
  });

  it('nothing for the author, a muted chat, someone watching it, or a non-attendee', async () => {
    const tour = await createTour();
    const [author, muted, watching] = await Promise.all([
      createMember(),
      createMember(),
      createMember(),
    ]);
    const outsider = await createMember();
    await createReservation(tour, [author, muted, watching]);
    for (const u of [author, muted, watching, outsider]) await subscribeDevice(u);
    await setChatMuted(muted._id, tour._id, true);

    await notifyChatPost(
      fakeIo([[String(watching._id), String(tour._id)]]),
      await post(tour, author, 'Hahó'),
    );
    expect(sentPushes()).toHaveLength(0);
  });

  it('a muted chat still lets a message that names you through', async () => {
    const tour = await createTour();
    const author = await createMember();
    const muted = await createMember({ username: 'Zoli' });
    await createReservation(tour, [author, muted]);
    await subscribeDevice(muted);
    await setChatMuted(muted._id, tour._id, true);

    await notifyChatPost(fakeIo(), await post(tour, author, 'Valami általános'));
    expect(sentPushes()).toHaveLength(0);
    await notifyChatPost(fakeIo(), await post(tour, author, 'Szia @zoli, jössz?'));
    expect(sentPushes()).toHaveLength(1);
    expect(sentPushes()[0][1]).toMatchObject({ silent: false });
  });

  it('"@bela" mentions Béla - no accents needed', async () => {
    const tour = await createTour();
    const author = await createMember();
    const bela = await createMember({ username: 'Béla' });
    await createReservation(tour, [author, bela]);
    await subscribeDevice(bela);
    await setChatMuted(bela._id, tour._id, true);

    await notifyChatPost(fakeIo(), await post(tour, author, 'Hozod a bográcsot, @bela?'));
    expect(sentPushes()).toHaveLength(1);
  });
});
