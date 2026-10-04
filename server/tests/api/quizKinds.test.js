import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createGuest, createMember } from '../helpers/factories.js';

// Móka → Kvíz: the kinds of question beyond the plain one and the picture
// (those: tests/api/quiz.test.js) - true or false, the song, the map.

// A fake Jellyfin: two playlists, the second one the members'.
const TRACKS = {
  'bodorgo-fm': [
    { id: 'a1', title: 'Tavaszi szél', artist: 'Népdal' },
    { id: 'b2', title: 'Az a szép', artist: 'Kormorán' },
  ],
  buli: [{ id: 'c3', title: 'Buli van', artist: 'Valaki' }],
};
vi.mock('../../src/music/jellyfin.js', async (original) => ({
  ...(await original()),
  playlistByKey: (key) => ({ membersOnly: key !== 'bodorgo-fm' }),
  playlistTracks: async (key) => TRACKS[key],
  fetchTrackAudio: async (itemId) =>
    new Response(`hang:${itemId}`, { headers: { 'content-type': 'audio/mpeg' } }),
}));

const QUIZZES = '/jatekok/quiz/quizzes';
const GAMES = '/jatekok/quiz/games';

const as = (user) => ({
  get: (url) => request(app).get(url).set(asUser(user)),
  post: (url, body = {}) => request(app).post(url).set(asUser(user)).send(body),
});

// A game of a one-question quiz, the question open, these players in.
async function playing(host, players, question) {
  const made = await as(host).post(QUIZZES, { title: 'Próba', questions: [question] });
  expect(made.status, made.body.message).toBe(201);
  const { quiz } = made.body.data;
  const { game } = (await as(host).post(`${QUIZZES}/${quiz._id}/games`)).body.data;
  for (const p of players) await as(p).post(`${GAMES}/${game._id}/join`);
  const open = await as(host).post(`${GAMES}/${game._id}/next`);
  expect(open.status, open.body.message).toBe(200);
  return { quiz, game: open.body.data.game };
}

describe('a true-or-false question', () => {
  it('has its two answers by itself', async () => {
    const host = await createMember();
    const anna = await createMember();
    const bad = await as(host).post(QUIZZES, {
      title: 'Próba',
      questions: [{ type: 'truefalse', text: 'A Kékes a legmagasabb.' }],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toContain('igaz vagy hamis');

    const { quiz, game } = await playing(host, [anna], {
      type: 'truefalse',
      text: 'A Kékes a legmagasabb.',
      answers: ['bármi', 'más', 'harmadik'],
      correct: 0,
    });
    expect(quiz.questions[0]).toMatchObject({ answers: ['Igaz', 'Hamis'], correct: 0 });
    expect(game.question).toMatchObject({ type: 'truefalse', answers: ['Igaz', 'Hamis'] });
    const done = (await as(anna).post(`${GAMES}/${game._id}/answers`, { answer: 0 })).body.data
      .game;
    expect(done.status).toBe('reveal');
    expect(done.players[0].points).toBeGreaterThan(500);
  });
});

describe('a song question', () => {
  const songQuestion = (song) => ({
    type: 'song',
    text: 'Melyik dal ez?',
    song,
    answers: ['Népdal – Tavaszi szél', 'Kormorán – Az a szép'],
    correct: 0,
  });

  it('needs a song of a playlist its author may hear', async () => {
    const guest = await createGuest();
    const create = (song) =>
      as(guest).post(QUIZZES, { title: 'Dalok', questions: [songQuestion(song)] });
    expect((await create(undefined)).body.message).toContain('válassz hozzá dalt');
    expect((await create({ playlist: 'bodorgo-fm', id: 'nincs' })).status).toBe(400);
    expect((await create({ playlist: 'nincs', id: 'a1' })).status).toBe(400);
    // The members' playlist isn't a guest's.
    expect((await create({ playlist: 'buli', id: 'c3' })).status).toBe(400);

    // Stored with the title and artist the playlist has - not what was sent.
    const made = await create({ playlist: 'bodorgo-fm', id: 'a1', title: 'Hamis cím' });
    expect(made.status).toBe(201);
    expect(made.body.data.quiz.questions[0].song).toEqual({
      playlist: 'bodorgo-fm',
      id: 'a1',
      title: 'Tavaszi szél',
      artist: 'Népdal',
    });
  });

  it('plays for the host only, and says which song it was once the question is closed', async () => {
    const host = await createMember();
    const anna = await createMember();
    const { game } = await playing(
      host,
      [anna],
      songQuestion({ playlist: 'bodorgo-fm', id: 'a1' }),
    );
    // Nothing in the open question says which song it is.
    expect(game.question.type).toBe('song');
    expect(game.question.song).toBeUndefined();
    expect(JSON.stringify(game.question)).not.toContain('a1');

    const url = `${GAMES}/${game._id}/song`;
    expect((await as(anna).get(url)).status).toBe(403);
    const audio = await as(host).get(url);
    expect(audio.status).toBe(200);
    expect(audio.headers['content-type']).toBe('audio/mpeg');
    expect(audio.body.toString()).toBe('hang:a1');

    const done = (await as(anna).post(`${GAMES}/${game._id}/answers`, { answer: 0 })).body.data
      .game;
    expect(done.question.song).toEqual({ title: 'Tavaszi szél', artist: 'Népdal' });
  });

  it('has no song to play on another kind of question', async () => {
    const host = await createMember();
    const { game } = await playing(host, [await createMember()], {
      text: 'Mi?',
      answers: ['a', 'b'],
      correct: 0,
    });
    expect((await as(host).get(`${GAMES}/${game._id}/song`)).status).toBe(404);
  });
});

describe('a map question', () => {
  // Hungary, more or less - and Eger in it.
  const bounds = { south: 45.7, west: 16.1, north: 48.6, east: 22.9 };
  const eger = { lat: 47.9, lng: 20.37 };
  const mapQuestion = (over = {}) => ({
    type: 'map',
    text: 'Hol van Eger?',
    place: eger,
    bounds,
    ...over,
  });

  it('needs a place on the part of the map that is shown', async () => {
    const host = await createMember();
    const create = (over) =>
      as(host).post(QUIZZES, { title: 'Térkép', questions: [mapQuestion(over)] });
    for (const over of [
      { place: undefined },
      { place: { lat: 'x', lng: 20 } },
      { bounds: undefined },
      { bounds: { ...bounds, north: 45 } },
      { place: { lat: 52.2, lng: 21 } }, // not on the map shown
    ]) {
      const res = await create(over);
      expect(res.status, JSON.stringify(over)).toBe(400);
      expect(res.body.message).toContain('térképen');
    }
    const made = await create({});
    expect(made.body.data.quiz.questions[0]).toMatchObject({ place: eger, bounds, answers: [] });
  });

  it('is answered with a pin that may be moved until it closes; the closest scores the most', async () => {
    const host = await createMember();
    const anna = await createMember({ name: 'Anna' });
    const bela = await createMember({ name: 'Béla' });
    const cili = await createMember({ name: 'Cili' });
    const { game } = await playing(host, [anna, bela, cili], mapQuestion());
    expect(game.question).toMatchObject({ type: 'map', bounds, answers: [] });
    expect(game.question.place).toBeUndefined();

    const pin = (user, lat, lng) => as(user).post(`${GAMES}/${game._id}/answers`, { lat, lng });
    expect((await pin(anna, 'x', 20)).status).toBe(400);
    expect((await pin(host, 47, 20)).status).toBe(403);

    // Anna starts far off (Sopron), then moves her pin right onto Eger.
    let now = (await pin(anna, 47.68, 16.59)).body.data.game;
    expect(now.myGuess).toEqual({ lat: 47.68, lng: 16.59 });
    now = (await pin(anna, eger.lat, eger.lng)).body.data.game;
    expect(now.myGuess).toEqual(eger);
    // Béla: Miskolc, some 50 km away. Cili doesn't answer.
    now = (await pin(bela, 48.1, 20.78)).body.data.game;
    // Everyone who will has a pin - it stays open all the same.
    expect(now.status).toBe('question');
    expect(now.players.filter((p) => p.answered)).toHaveLength(2);
    expect(now.players.every((p) => p.guess === undefined && p.score === 0)).toBe(true);

    now = (await as(host).post(`${GAMES}/${game._id}/next`)).body.data.game;
    expect(now.status).toBe('reveal');
    expect(now.question.place).toEqual(eger);
    const [first, second, third] = now.players;
    expect(first).toMatchObject({ name: 'Anna', points: 1000, km: 0, guess: eger });
    expect(second.name).toBe('Béla');
    expect(second.km).toBeGreaterThan(30);
    expect(second.km).toBeLessThan(50);
    expect(second.points).toBeGreaterThan(800);
    expect(second.points).toBeLessThan(1000);
    expect(third).toMatchObject({ name: 'Cili', points: 0, km: null, guess: null });

    // Closed: the pin stays where it was.
    expect((await pin(bela, eger.lat, eger.lng)).status).toBe(400);
  });
});
