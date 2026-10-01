import request from 'supertest';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember, createReservation, createTour } from '../helpers/factories.js';
import Poll from '../../src/models/pollModel.js';
import Post from '../../src/models/postModel.js';
import {
  generalChatRoom,
  tourChatClosed,
  tourChatPast,
  tourChatRoom,
} from '../../src/chat/chatRooms.js';
import { markChatRead } from '../../src/chat/chatNotifications.js';

// The list of Kotyogós: last message, unread count, people - and a past
// tour's chat as a read-only archive.

const day = 24 * 3600 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * day);

describe("a tour's chat closes 14 days after its last day", () => {
  it('open before and during the tour and for 14 days after; closed from then on', () => {
    const tour = (startDate) => ({ startDate, duration: 3 }); // last day: start + 2
    expect(tourChatClosed(tour(new Date(Date.now() + 30 * day)))).toBe(false);
    expect(tourChatClosed(tour(daysAgo(1)))).toBe(false);
    expect(tourChatClosed(tour(daysAgo(2 + 13)))).toBe(false);
    expect(tourChatClosed(tour(daysAgo(2 + 15)))).toBe(true);
  });

  it('the test tour (11) is past like any other, but stays writable', () => {
    const eleven = { order: 11, startDate: daysAgo(400), duration: 3 };
    expect(tourChatPast(eleven)).toBe(true);
    expect(tourChatClosed(eleven)).toBe(false);
  });
});

describe('GET /chat-rooms/overview', () => {
  it('lists the general room and every tour with last message, unread count and people', async () => {
    const me = await createMember();
    const anna = await createMember({ username: 'anna', name: 'Kiss Anna' });
    const bela = await createMember({ name: 'Nagy Béla' }); // no username

    const upcoming = await createTour({ title: 'Jövő' });
    const past = await createTour({ title: 'Régi', startDate: daysAgo(100), duration: 3 });
    const untouched = await createTour({ title: 'Néma' });
    await createReservation(upcoming, [me, anna, bela]);

    const general = await generalChatRoom();
    const upcomingRoom = await tourChatRoom(upcoming._id);
    const pastRoom = await tourChatRoom(past._id);

    await Post.create({ chatRoomId: general._id, creator: bela._id, text: 'Sziasztok' });
    await Post.create({ chatRoomId: upcomingRoom._id, creator: anna._id, text: 'régebbi' });
    // What I've seen, and what came after: two from the others, one my own.
    await markChatRead(me._id, upcomingRoom._id);
    await new Promise((resolve) => setTimeout(resolve, 15));
    await Post.create({ chatRoomId: upcomingRoom._id, creator: bela._id, text: 'új 1' });
    await Post.create({ chatRoomId: upcomingRoom._id, creator: me._id, text: 'az enyém' });
    await Post.create({ chatRoomId: upcomingRoom._id, creator: anna._id, text: 'x'.repeat(200) });
    await Post.create({ chatRoomId: pastRoom._id, creator: anna._id, text: 'emlék' });

    const res = await request(app).get('/chat-rooms/overview').set(asUser(me));
    expect(res.status).toBe(200);
    const { general: g, tours } = res.body.data;
    const of = (tour) => tours.find((t) => t.tourId === String(tour._id));

    // The general room: never opened by me - its one message is unread; a
    // name stands in for a missing username.
    expect(g).toMatchObject({ chatRoomId: String(general._id), unread: 1 });
    expect(g.lastPost).toMatchObject({ author: 'Nagy Béla', text: 'Sziasztok' });
    expect(g.memberCount).toBeGreaterThanOrEqual(3);

    // An open tour: the others' messages since I last looked, the latest
    // one shortened, its attendees counted.
    expect(of(upcoming)).toMatchObject({
      chatRoomId: String(upcomingRoom._id),
      closed: false,
      unread: 2,
      memberCount: 3,
    });
    expect(of(upcoming).lastPost).toMatchObject({ author: 'anna', hasImage: false, isPoll: false });
    expect(of(upcoming).lastPost.text).toHaveLength(80);

    // A past tour: an archive - listed with its last message, nothing unread.
    expect(of(past)).toMatchObject({ past: true, closed: true, unread: 0 });
    expect(of(upcoming).past).toBe(false);
    expect(of(past).lastPost.text).toBe('emlék');

    // A tour whose chat nobody has opened yet.
    expect(of(untouched)).toMatchObject({
      chatRoomId: null,
      closed: false,
      lastPost: null,
      unread: 0,
      memberCount: 0,
    });
  });

  it('needs a login', async () => {
    expect((await request(app).get('/chat-rooms/overview')).status).toBe(401);
  });
});

describe('a closed chat is read-only', () => {
  it('refuses a new poll - from an admin too', async () => {
    const past = await createTour({ startDate: daysAgo(100), duration: 3 });
    const res = await request(app)
      .post(`/tours/${past._id}/polls`)
      .set(asUser(await createAdmin()))
      .send({
        question: 'Még egy kérdés?',
        options: ['Igen', 'Nem'],
        closesAt: new Date(Date.now() + day).toISOString(),
      });
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('lezárult');
    expect(await Poll.countDocuments({ tour: past._id })).toBe(0);
  });

  it('refuses a photo', async () => {
    const past = await createTour({ startDate: daysAgo(100), duration: 3 });
    const room = await tourChatRoom(past._id);
    const photo = await sharp({
      create: { width: 40, height: 40, channels: 3, background: '#5a8' },
    })
      .jpeg()
      .toBuffer();
    const res = await request(app)
      .post(`/chat-rooms/${room._id}/images`)
      .set(asUser(await createMember()))
      .attach('image', photo, { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(403);
    expect(await Post.countDocuments({ chatRoomId: room._id })).toBe(0);
  });
});
