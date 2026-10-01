import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createGuest, createMember } from '../helpers/factories.js';
import ChatGame from '../../src/models/chatGameModel.js';
import Post from '../../src/models/postModel.js';
import { generalChatRoom } from '../../src/chat/chatRooms.js';
import { currentGame, onGeneralTextPost } from '../../src/chat/firstWritersGame.js';

// The launch game: the first three to write in Bódorgók.

// tests/setup.js: INITIAL_ADMIN_USER=owner@test.local - the organizer.
const createOrganizer = () => createAdmin({ email: 'owner@test.local', name: 'Szervező Zoli' });

// A stand-in for the Socket.IO server: what was sent to the chat's channel.
function fakeIo() {
  const sent = [];
  return {
    sent,
    to: () => ({ emit: (event, payload) => sent.push({ event, payload }) }),
    // notifyChatPost asks who is looking at the chat right now.
    in: () => ({ fetchSockets: async () => [] }),
    fetchSockets: async () => [],
  };
}

// A text message in the general room, as chatSocket.js hands it over.
async function writes(io, user, text = 'itt vagyok') {
  const room = await generalChatRoom();
  const post = await Post.create({ chatRoomId: room._id, creator: user._id, text });
  await onGeneralTextPost(io, post);
  return post;
}

const games = (io) => io.sent.filter((s) => s.event === 'chat-game').map((s) => s.payload);

describe('the first-writers game', () => {
  it("doesn't start until the organizer writes - others' messages before that win nothing", async () => {
    const io = fakeIo();
    await writes(io, await createMember());
    expect(await currentGame()).toBeNull();
    expect(io.sent).toEqual([]);

    await writes(io, await createOrganizer(), 'Játék! Az első három, aki ír, nyer.');
    const game = await currentGame();
    expect(game).toMatchObject({ finishedAt: null, places: 3, winners: [] });
    // Everyone in the chat is told: the (empty) podium appears.
    expect(games(io)).toEqual([{ game: expect.objectContaining({ winners: [] }), newPlace: null }]);
  });

  it('gives the three places to the first three others, one each, and then announces the result', async () => {
    const io = fakeIo();
    const organizer = await createOrganizer();
    const anna = await createMember({ name: 'Kiss Anna', username: 'anna' });
    const bela = await createGuest({ name: 'Nagy Béla' });
    const cili = await createAdmin({ name: 'Tóth Cili' });
    const dani = await createMember({ name: 'Kis Dani' });

    await writes(io, organizer, 'Rajt!');
    await writes(io, organizer, 'még egy szó tőlem'); // the organizer never wins
    await writes(io, anna, 'a'); // one letter is enough
    await writes(io, anna, 'megint én'); // one place a person
    await writes(io, bela);
    expect((await currentGame()).finishedAt).toBeNull();
    await writes(io, cili); // another admin can win
    await writes(io, dani); // too late

    const game = await currentGame();
    expect(game.winners.map((w) => [w.place, w.name, w.username])).toEqual([
      [1, 'Kiss Anna', 'anna'],
      [2, 'Nagy Béla', null],
      [3, 'Tóth Cili', null],
    ]);
    expect(game.finishedAt).not.toBeNull();

    // Each place was announced once, as it was taken.
    expect(
      games(io)
        .map((g) => g.newPlace)
        .filter(Boolean),
    ).toEqual([1, 2, 3]);

    // The result is a message in the chat, from the organizer.
    const room = await generalChatRoom();
    const result = await Post.findOne({ chatRoomId: room._id, text: /nyertesei/ });
    expect(String(result.creator)).toBe(String(organizer._id));
    expect(result.text).toContain('🥇 1. hely: Kiss Anna');
    expect(result.text).toContain('🥈 2. hely: Nagy Béla');
    expect(result.text).toContain('🥉 3. hely: Tóth Cili');
    expect(io.sent.some((s) => s.event === 'new-post' && s.payload.text === result.text)).toBe(
      true,
    );
  });

  it('two messages arriving together take two different places - never more than three', async () => {
    const io = fakeIo();
    await writes(io, await createOrganizer(), 'Rajt!');
    const players = await Promise.all([1, 2, 3, 4, 5].map(() => createMember()));
    await Promise.all(players.map((p) => writes(io, p)));

    const game = await ChatGame.findOne({ key: 'first-writers' });
    expect(game.winners).toHaveLength(3);
    expect(new Set(game.winners.map((w) => String(w.user))).size).toBe(3);
    expect(
      games(io)
        .map((g) => g.newPlace)
        .filter(Boolean)
        .sort(),
    ).toEqual([1, 2, 3]);
  });

  it('is played once: after it, nothing restarts it - and the podium goes after a day', async () => {
    const io = fakeIo();
    const organizer = await createOrganizer();
    await writes(io, organizer, 'Rajt!');
    for (let i = 0; i < 3; i += 1) await writes(io, await createMember());
    io.sent.length = 0;

    await writes(io, organizer, 'Na még egyszer?');
    await writes(io, await createMember());
    expect(games(io)).toEqual([]);
    expect(await ChatGame.countDocuments()).toBe(1);

    // Still shown for a day after the last place...
    expect((await currentGame()).winners).toHaveLength(3);
    // ...and gone after that.
    await ChatGame.updateOne({}, { finishedAt: new Date(Date.now() - 25 * 3600 * 1000) });
    expect(await currentGame()).toBeNull();
  });
});

describe('GET /chat-rooms/general/game', () => {
  it('gives the podium to anyone logged in - null before the game', async () => {
    const member = await createMember();
    const before = await request(app).get('/chat-rooms/general/game').set(asUser(member));
    expect(before.status).toBe(200);
    expect(before.body.data.game).toBeNull();

    const io = fakeIo();
    await writes(io, await createOrganizer(), 'Rajt!');
    await writes(io, member);
    const after = await request(app).get('/chat-rooms/general/game').set(asUser(member));
    expect(after.body.data.game.winners).toEqual([
      expect.objectContaining({ place: 1, userId: String(member._id), name: member.name }),
    ]);

    expect((await request(app).get('/chat-rooms/general/game')).status).toBe(401);
  });
});
