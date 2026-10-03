import request from 'supertest';
import webpush from 'web-push';
import { describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember, createReservation, createTour } from '../helpers/factories.js';
import Poll from '../../src/models/pollModel.js';
import Post from '../../src/models/postModel.js';
import { checkPollReminders } from '../../src/chat/pollReminders.js';

const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
const pushedTo = () =>
  vi
    .mocked(webpush.sendNotification)
    .mock.calls.map(([sub, body]) => [sub.endpoint, JSON.parse(body)]);

async function setup() {
  const tour = await createTour({ order: 25, title: 'Sarud' });
  const [anna, bela, cili] = await Promise.all([
    createMember({ name: 'Anna', username: 'anna' }),
    createMember({ name: 'Béla', username: 'Béla' }),
    createMember({ name: 'Cili', username: 'cili' }),
  ]);
  await createReservation(tour, [anna, bela, cili]);
  for (const [i, u] of [anna, bela, cili].entries()) {
    await request(app)
      .post('/push/subscriptions')
      .set(asUser(u))
      .send({ endpoint: `https://push.test/${u._id}-${i}`, keys: { p256dh: 'p', auth: 'a' } });
  }
  return { tour, anna, bela, cili };
}

const startPoll = (tour, user, body = {}) =>
  request(app)
    .post(`/tours/${tour._id}/polls`)
    .set(asUser(user))
    .send({
      question: 'Pénteken múzeum?',
      options: ['Igen', 'Nem'],
      closesAt: inHours(24),
      visibility: 'open',
      minimumCount: 2,
      ...body,
    });

describe('polls started from the chat', () => {
  it('an attendee starts one: a chat message carries it, the others are notified', async () => {
    const { tour, anna, bela } = await setup();
    const res = await startPoll(tour, anna);
    expect(res.status).toBe(201);
    const poll = res.body.data.poll;
    expect(poll).toMatchObject({
      visibility: 'open',
      canManage: true,
      minimum: { count: 2, current: 0, reached: false },
    });

    const post = await Post.findById(poll.post);
    expect(String(post.poll)).toBe(poll._id);
    expect(post.text).toBe('Pénteken múzeum?');

    // Béla and Cili - not Anna herself.
    await vi.waitFor(() => expect(pushedTo()).toHaveLength(2));
    const endpoints = pushedTo().map(([e]) => e);
    expect(endpoints).toContain(`https://push.test/${bela._id}-1`);
    expect(endpoints.some((e) => e.includes(String(anna._id)))).toBe(false);
    expect(pushedTo()[0][1]).toMatchObject({ title: '25. Sarud – szavazás', renotify: true });
  });

  it('someone not on the tour may not start one; a past deadline is refused', async () => {
    const { tour, anna } = await setup();
    expect((await startPoll(tour, await createMember())).status).toBe(403);
    expect((await startPoll(tour, await createAdmin())).status).toBe(201); // an admin may, signed up or not
    expect((await startPoll(tour, anna, { closesAt: inHours(-1) })).status).toBe(400);
  });

  it('open poll: names are shown; reaching the minimum tells the yes-voters, once', async () => {
    const { tour, anna, bela, cili } = await setup();
    const { _id: id, options } = (await startPoll(tour, anna)).body.data.poll;
    // The start's own notices (to Béla and Cili) go out after the answer:
    // they're let through first, so they aren't counted below.
    await vi.waitFor(() => expect(pushedTo()).toHaveLength(2));
    vi.mocked(webpush.sendNotification).mockClear();
    const vote = (u, i) =>
      request(app).post(`/polls/${id}/vote`).set(asUser(u)).send({ optionId: options[i]._id });

    await vote(anna, 0);
    const beforeBela = await request(app).get(`/polls/${id}`).set(asUser(bela));
    // Open: Béla sees results and names before voting.
    expect(beforeBela.body.data.poll.results[0].voters).toEqual([
      expect.objectContaining({ name: 'anna' }),
    ]);
    expect(pushedTo()).toHaveLength(0);

    const reached = await vote(bela, 0);
    expect(reached.body.data.poll.minimum).toMatchObject({ current: 2, reached: true });
    await vi.waitFor(() =>
      expect(pushedTo().map(([, p]) => p.title)).toEqual([
        'Összejött! – 25. Sarud',
        'Összejött! – 25. Sarud',
      ]),
    );

    await vote(cili, 0);
    expect(pushedTo()).toHaveLength(2); // told once
  });

  it('secret poll: no names, counts only after voting', async () => {
    const { tour, anna, bela } = await setup();
    const { _id: id, options } = (
      await startPoll(tour, anna, { visibility: 'secret', minimumCount: null })
    ).body.data.poll;
    await request(app)
      .post(`/polls/${id}/vote`)
      .set(asUser(anna))
      .send({ optionId: options[1]._id });
    expect(
      (await request(app).get(`/polls/${id}`).set(asUser(bela))).body.data.poll.results,
    ).toBeNull();
    const mine = await request(app).get(`/polls/${id}`).set(asUser(anna));
    expect(mine.body.data.poll.results[1]).toMatchObject({ count: 1 });
    expect(mine.body.data.poll.results[1].voters).toBeUndefined();
  });

  it('the one who started it or an admin closes/deletes it; the chat message becomes a placeholder', async () => {
    const { tour, anna, bela } = await setup();
    const { _id: id, post } = (await startPoll(tour, anna)).body.data.poll;
    expect((await request(app).post(`/polls/${id}/close`).set(asUser(bela))).status).toBe(403);
    const closed = await request(app).post(`/polls/${id}/close`).set(asUser(anna));
    expect(closed.body.data.poll.isClosed).toBe(true);

    expect((await request(app).delete(`/polls/${id}`).set(asUser(bela))).status).toBe(403);
    expect((await request(app).delete(`/polls/${id}`).set(asUser(anna))).status).toBe(204);
    const placeholder = await Post.findById(post);
    expect(placeholder.deletedAt).toBeInstanceOf(Date);
    expect(placeholder.poll).toBeNull();
  });

  it('the Voks badge counts open polls on my tours I have not voted in', async () => {
    const { tour, anna, bela } = await setup();
    const { _id: id, options } = (await startPoll(tour, anna)).body.data.poll;
    await startPoll(tour, anna, { question: 'Hol együnk?' });
    const count = async (u) =>
      (await request(app).get('/polls/pending').set(asUser(u))).body.data.count;
    expect(await count(bela)).toBe(2);
    await request(app)
      .post(`/polls/${id}/vote`)
      .set(asUser(bela))
      .send({ optionId: options[0]._id });
    expect(await count(bela)).toBe(1);
    expect(await count(await createMember())).toBe(0); // not on the tour
  });
});

describe('the 2-hour reminder', () => {
  it('reminds those who have not voted, once; skips a poll started less than 2 hours before', async () => {
    const { tour, anna, bela } = await setup();
    const { _id: id, options } = (await startPoll(tour, anna, { closesAt: inHours(1.5) })).body.data
      .poll;
    // Pretend it was started a day ago (straight to the collection -
    // Mongoose won't change createdAt).
    await Poll.collection.updateOne(
      { _id: new Poll({ _id: id })._id },
      { $set: { createdAt: new Date(Date.now() - 24 * 3600 * 1000) } },
    );
    await request(app)
      .post(`/polls/${id}/vote`)
      .set(asUser(anna))
      .send({ optionId: options[0]._id });

    const [reminder] = await checkPollReminders();
    expect(reminder.users).toHaveLength(2); // Béla and Cili - Anna voted
    expect(reminder.users).toContain(String(bela._id));
    expect(await checkPollReminders()).toHaveLength(0); // once

    const fresh = (await startPoll(tour, anna, { closesAt: inHours(1) })).body.data.poll;
    await checkPollReminders();
    expect((await Poll.findById(fresh._id)).reminderSentAt).toBeInstanceOf(Date); // looked at, but nobody reminded
  });
});

describe('polls in the general Kotyogó', () => {
  it('anyone starts one; everyone is told; it counts on the Voks badge and gets the reminder', async () => {
    const { generalChatRoom } = await import('../../src/chat/chatRooms.js');
    const { createGuest } = await import('../helpers/factories.js');
    const [guest, anna, bela] = await Promise.all([
      createGuest({ name: 'Vendég', username: 'vendeg' }),
      createMember({ name: 'Anna', username: 'anna' }),
      createMember({ name: 'Béla', username: 'bela' }),
    ]);
    for (const u of [guest, anna, bela]) {
      await request(app)
        .post('/push/subscriptions')
        .set(asUser(u))
        .send({ endpoint: `https://push.test/g-${u._id}`, keys: { p256dh: 'p', auth: 'a' } });
    }

    const res = await request(app)
      .post('/chat-rooms/general/polls')
      .set(asUser(guest))
      .send({
        question: 'Mikor legyen a klubest?',
        options: ['Péntek', 'Szombat'],
        closesAt: inHours(5),
      });
    expect(res.status).toBe(201);
    const poll = res.body.data.poll;
    expect(poll.tour).toBeNull();

    // In the general room, as a chat message.
    const post = await Post.findById(poll.post);
    expect(String(post.chatRoomId)).toBe(String((await generalChatRoom())._id));

    // Everyone but the one who started it is told.
    await vi.waitFor(() => {
      const titles = pushedTo().map(([endpoint, p]) => [endpoint, p.title]);
      expect(titles).toEqual(
        expect.arrayContaining([
          [`https://push.test/g-${anna._id}`, 'Általános – szavazás'],
          [`https://push.test/g-${bela._id}`, 'Általános – szavazás'],
        ]),
      );
      expect(titles.some(([e]) => e === `https://push.test/g-${guest._id}`)).toBe(false);
    });

    // Waiting for Anna's vote (she's on no tour at all).
    const pending = await request(app).get('/polls/pending').set(asUser(anna));
    expect(pending.body.data.count).toBe(1);

    // Two hours before it closes: the reminder, to those who haven't voted.
    await request(app)
      .post(`/polls/${poll._id}/vote`)
      .set(asUser(anna))
      .send({ optionId: poll.options[0]._id });
    vi.mocked(webpush.sendNotification).mockClear();
    const [reminder] = await checkPollReminders(new Date(Date.now() + 4 * 3600 * 1000));
    expect(reminder.users).toContain(String(bela._id));
    expect(reminder.users).not.toContain(String(anna._id));
    await vi.waitFor(() =>
      expect(pushedTo().some(([, p]) => p.title === 'Még nem szavaztál – Általános')).toBe(true),
    );
  });
});

describe('poll details (Részletek)', () => {
  it('keeps the formatting, drops anything else, and can be fixed even after votes', async () => {
    const { tour, anna, bela } = await setup();
    const res = await startPoll(tour, anna, {
      details:
        '<p>Nézd meg <a href="https://muzeum.hu">itt</a>:</p><ul><li><strong>10 óra</strong></li></ul><script>alert(1)</script><img src=x onerror=alert(1)>',
    });
    const { details, _id, options } = res.body.data.poll;
    expect(details).toContain('<strong>10 óra</strong>');
    expect(details).toContain('href="https://muzeum.hu"');
    expect(details).toContain('target="_blank"');
    expect(details).not.toContain('script');
    expect(details).not.toContain('img');

    const blank = await startPoll(tour, anna, { details: '<p><br></p>' });
    expect(blank.body.data.poll.details).toBe('');

    await request(app)
      .post(`/polls/${_id}/vote`)
      .set(asUser(bela))
      .send({ optionId: options[0]._id });
    const admin = await createAdmin();
    const fixed = await request(app)
      .patch(`/polls/${_id}`)
      .set(asUser(admin))
      .send({ details: '<p>Új link: <a href="https://uj.hu">ide</a></p>' });
    expect(fixed.status).toBe(200);
    expect(fixed.body.data.poll.details).toContain('https://uj.hu');
  });
});

describe('Rád vár - the polls waiting for my vote', () => {
  it('marks exactly what the Voks badge counts', async () => {
    const { tour, anna, bela } = await setup();
    const other = await createTour({ order: 26, title: 'Máshol' });
    const outsider = await createMember();
    await createReservation(other, [outsider]);
    const mine = (await startPoll(tour, anna)).body.data.poll;
    const notMine = (await startPoll(other, outsider)).body.data.poll;

    const list = await request(app).get('/polls').set(asUser(bela));
    const byId = Object.fromEntries(list.body.data.polls.map((p) => [p._id, p]));
    expect(byId[mine._id].awaitsMyVote).toBe(true);
    expect(byId[notMine._id].awaitsMyVote).toBe(false);
    expect((await request(app).get('/polls/pending').set(asUser(bela))).body.data.count).toBe(1);

    const voted = await request(app)
      .post(`/polls/${mine._id}/vote`)
      .set(asUser(bela))
      .send({ optionId: mine.options[0]._id });
    expect(voted.body.data.poll.awaitsMyVote).toBe(false);
    expect((await request(app).get('/polls/pending').set(asUser(bela))).body.data.count).toBe(0);
  });
});
