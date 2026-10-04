import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createGuest, createMember, createTour } from '../helpers/factories.js';
import { QuizGame } from '../../src/models/quizModels.js';
import Tour from '../../src/models/tourModel.js';
import { quizImagePath } from '../../src/jatekok/quiz/quizImages.js';

// Móka → Kvíz over HTTP (the rules themselves: tests/unit/quizScoring.test.js).

const QUIZZES = '/jatekok/quiz/quizzes';
const GAMES = '/jatekok/quiz/games';

const quizBody = (over = {}) => ({
  title: 'Táborok',
  questions: [
    { text: 'Hol volt az első tábor?', answers: ['Mátra', 'Bükk', 'Zemplén'], correct: 1 },
    { text: 'Hányan voltunk?', answers: ['10', '20'], correct: 0, timeLimitSec: 10 },
  ],
  ...over,
});

const as = (user) => ({
  get: (url) => request(app).get(url).set(asUser(user)),
  post: (url, body = {}) => request(app).post(url).set(asUser(user)).send(body),
  put: (url, body) => request(app).put(url).set(asUser(user)).send(body),
  delete: (url) => request(app).delete(url).set(asUser(user)),
});

async function createQuiz(user, over) {
  const res = await as(user).post(QUIZZES, quizBody(over));
  expect(res.status, res.body.message).toBe(201);
  return res.body.data.quiz;
}

// A game of the host's quiz in the lobby, with these players in.
async function startGame(host, players = [], over) {
  const quiz = await createQuiz(host, over);
  const res = await as(host).post(`${QUIZZES}/${quiz._id}/games`);
  expect(res.status, res.body.message).toBe(201);
  const { game } = res.body.data;
  for (const p of players) {
    expect((await as(p).post(`${GAMES}/${game._id}/join`)).status).toBe(200);
  }
  return game;
}

const next = async (host, game) => {
  const res = await as(host).post(`${GAMES}/${game._id}/next`);
  expect(res.status, res.body.message).toBe(200);
  return res.body.data.game;
};
const answer = (user, game, n) => as(user).post(`${GAMES}/${game._id}/answers`, { answer: n });

describe('quizzes', () => {
  it('are for everyone logged in - a guest too, not only whoever sees the rest of Móka', async () => {
    expect((await request(app).get(QUIZZES)).status).toBe(401);
    for (const user of [await createAdmin(), await createMember(), await createGuest()]) {
      expect((await as(user).get(QUIZZES)).status).toBe(200);
      expect((await as(user).post(QUIZZES, quizBody())).status).toBe(201);
    }
  });

  it('are listed for everyone without their questions; those are the author’s', async () => {
    const anna = await createMember({ name: 'Kiss Anna', username: 'anna' });
    const bela = await createMember();
    const quiz = await createQuiz(anna);
    expect(quiz).toMatchObject({ title: 'Táborok', questionCount: 2, mine: true });
    expect(quiz.questions[0]).toEqual({
      type: 'choice',
      text: 'Hol volt az első tábor?',
      image: null,
      answers: ['Mátra', 'Bükk', 'Zemplén'],
      correct: 1,
      timeLimitSec: 20,
    });

    const list = (await as(bela).get(QUIZZES)).body.data.quizzes;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ questionCount: 2, mine: false, createdBy: { name: 'anna' } });
    expect(list[0].questions).toBeUndefined();

    expect((await as(bela).get(`${QUIZZES}/${quiz._id}`)).status).toBe(403);
    expect((await as(anna).get(`${QUIZZES}/${quiz._id}`)).body.data.quiz.questions).toHaveLength(2);
  });

  it('are changed, deleted and started only by their author - an admin neither', async () => {
    const anna = await createMember();
    const admin = await createAdmin({ canManageRoles: true });
    const quiz = await createQuiz(anna);
    const url = `${QUIZZES}/${quiz._id}`;

    expect((await as(admin).put(url, quizBody({ title: 'Más' }))).status).toBe(403);
    expect((await as(admin).delete(url)).status).toBe(403);
    expect((await as(admin).post(`${url}/games`)).status).toBe(403);

    expect((await as(anna).put(url, { title: '', questions: [] })).status).toBe(400);
    const changed = await as(anna).put(url, quizBody({ title: 'Új cím' }));
    expect(changed.body.data.quiz.title).toBe('Új cím');

    expect((await as(anna).delete(url)).status).toBe(204);
    expect((await as(anna).get(url)).status).toBe(404);
    expect((await as(anna).get(`${QUIZZES}/nem-id`)).status).toBe(404);
  });

  it('refuse a quiz that makes no sense', async () => {
    const anna = await createMember();
    const res = await as(anna).post(
      QUIZZES,
      quizBody({ questions: [{ text: 'Mi?', answers: ['a'] }] }),
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('1. kérdés');
  });
});

describe('a quiz game', () => {
  it('waits in the lobby with a code; the players join, the host does not play', async () => {
    const host = await createMember({ name: 'Nagy Zoli' });
    const anna = await createMember({ name: 'Kiss Anna', username: 'anna' });
    const game = await startGame(host);
    expect(game).toMatchObject({
      title: 'Táborok',
      status: 'lobby',
      questionCount: 2,
      questionIdx: -1,
      players: [],
      question: null,
      host: { name: 'Nagy Zoli' },
    });
    expect(game.pin).toMatch(/^\d{6}$/);

    // Nobody in yet: nothing to start.
    expect((await as(host).post(`${GAMES}/${game._id}/next`)).status).toBe(400);
    expect((await as(host).post(`${GAMES}/${game._id}/join`)).status).toBe(400);

    const byPin = await as(anna).get(`${GAMES}/pin/${game.pin}`);
    expect(byPin.body.data.gameId).toBe(game._id);
    expect((await as(anna).get(`${GAMES}/pin/000000`)).status).toBe(404);

    // Twice is once.
    await as(anna).post(`${GAMES}/${game._id}/join`);
    const joined = (await as(anna).post(`${GAMES}/${game._id}/join`)).body.data.game;
    expect(joined.players).toHaveLength(1);
    expect(joined.players[0]).toMatchObject({ name: 'anna', score: 0, rank: 1, answered: false });
  });

  it('is led by its host alone', async () => {
    const host = await createMember();
    const anna = await createMember();
    const game = await startGame(host, [anna]);
    for (const step of ['next', 'abandon']) {
      expect((await as(anna).post(`${GAMES}/${game._id}/${step}`)).status).toBe(403);
    }
    expect((await as(anna).get(`${GAMES}/${game._id}/qr`)).status).toBe(403);
    expect((await as(host).get(`${GAMES}/nem-id`)).status).toBe(404);
  });

  it('gives the host a QR code of the game’s link - on a known address only', async () => {
    const host = await createMember();
    const game = await startGame(host);
    const qr = await as(host).get(`${GAMES}/${game._id}/qr?origin=http://localhost:4200`);
    expect(qr.body.data.url).toBe(`http://localhost:4200/moka/kviz/jatekok/${game._id}`);
    expect(qr.body.data.qr).toMatch(/^data:image\/png;base64,/);
    expect((await as(host).get(`${GAMES}/${game._id}/qr?origin=https://mas.hu`)).status).toBe(400);
  });

  it('is played question by question: fast right answers score, the answer shows only after', async () => {
    const host = await createMember();
    const anna = await createMember({ name: 'Anna' });
    const bela = await createMember({ name: 'Béla' });
    const cili = await createMember({ name: 'Cili' });
    const game = await startGame(host, [anna, bela, cili]);

    // The first question: no right answer in it, for the host neither.
    let now = await next(host, game);
    expect(now).toMatchObject({ status: 'question', questionIdx: 0 });
    expect(now.question).toMatchObject({ answers: ['Mátra', 'Bükk', 'Zemplén'], timeLimitSec: 20 });
    expect(now.question.correct).toBeUndefined();
    expect(now.question.counts).toBeUndefined();

    expect((await answer(host, game, 1)).status).toBe(403);
    expect((await answer(anna, game, 3)).status).toBe(400);
    expect((await answer(anna, game, '1')).status).toBe(400);

    // Anna is right. Nothing shows it yet - only that she has answered.
    now = (await answer(anna, game, 1)).body.data.game;
    expect(now.status).toBe('question');
    expect(now.myAnswer).toBe(1);
    expect(now.players.find((p) => p.name === 'Anna')).toMatchObject({ answered: true, score: 0 });
    expect(now.players[0].points).toBeUndefined();
    expect((await answer(anna, game, 0)).status).toBe(400);
    // Someone else sees no answer of their own.
    expect((await as(bela).get(`${GAMES}/${game._id}`)).body.data.game.myAnswer).toBeNull();

    // Béla is wrong; with Cili's the last answer is in: the question closes itself.
    await answer(bela, game, 0);
    now = (await answer(cili, game, 1)).body.data.game;
    expect(now.status).toBe('reveal');
    expect(now.question).toMatchObject({ correct: 1, counts: [1, 2, 0] });
    expect(now.players.map((p) => [p.name, p.rank, p.answer, p.points > 0])).toEqual([
      ['Anna', 1, 1, true],
      ['Cili', 2, 1, true],
      ['Béla', 3, 0, false],
    ]);
    expect(now.players[0].score).toBeGreaterThan(500);
    expect(now.players[0].score).toBeLessThanOrEqual(1000);
    expect((await answer(bela, game, 1)).status).toBe(400);

    // The standings, for everyone to read: no question on the screen, but
    // what the last one brought each player still is.
    now = await next(host, game);
    expect(now).toMatchObject({ status: 'standings', question: null, questionIdx: 0 });
    expect(now.pin).toBe(game.pin);
    expect(now.players.map((p) => [p.name, p.points > 0])).toEqual([
      ['Anna', true],
      ['Cili', true],
      ['Béla', false],
    ]);
    expect((await answer(bela, game, 1)).status).toBe(400);

    // The second, last one: the host closes it early; who didn't answer gets nothing.
    now = await next(host, game);
    expect(now).toMatchObject({ status: 'question', questionIdx: 1 });
    expect(now.players.every((p) => !p.answered)).toBe(true);
    await answer(bela, game, 0);
    now = await next(host, game);
    expect(now.status).toBe('reveal');
    expect(now.question.counts).toEqual([1, 0]);

    now = await next(host, game);
    expect(now).toMatchObject({ status: 'finished', question: null, pin: null });
    expect(now.finishedAt).toBeTruthy();
    // One right answer each - milliseconds decide between them.
    expect(now.players.map((p) => p.rank)).toEqual([1, 2, 3]);
    expect(now.players.map((p) => `${p.name} ${p.correct}`).sort()).toEqual([
      'Anna 1',
      'Béla 1',
      'Cili 1',
    ]);

    // Over: nothing more to lead or to join.
    expect((await as(host).post(`${GAMES}/${game._id}/next`)).status).toBe(400);
    expect((await as(await createMember()).post(`${GAMES}/${game._id}/join`)).status).toBe(400);
    expect((await as(anna).get(`${GAMES}/pin/${game.pin}`)).status).toBe(404);
  });

  it('closes a question whose time is up, even if its clock was lost', async () => {
    const host = await createMember();
    const anna = await createMember();
    const game = await startGame(host, [anna]);
    await next(host, game);
    await QuizGame.updateOne(
      { _id: game._id },
      { questionStartedAt: new Date(Date.now() - 60000) },
    );

    const late = await answer(anna, game, 1);
    expect(late.status).toBe(400);
    expect((await as(anna).get(`${GAMES}/${game._id}`)).body.data.game.status).toBe('reveal');
  });

  it('lets a latecomer in mid-game', async () => {
    const host = await createMember();
    const anna = await createMember({ name: 'Anna' });
    const bela = await createMember({ name: 'Béla' });
    const game = await startGame(host, [anna]);
    await next(host, game);
    expect((await as(bela).post(`${GAMES}/${game._id}/join`)).body.data.game.players).toHaveLength(
      2,
    );
    expect((await answer(bela, game, 1)).status).toBe(200);
  });

  it('keeps the questions it was started with, whatever happens to the quiz', async () => {
    const host = await createMember();
    const anna = await createMember();
    const quiz = await createQuiz(host);
    const game = (await as(host).post(`${QUIZZES}/${quiz._id}/games`)).body.data.game;
    await as(anna).post(`${GAMES}/${game._id}/join`);
    await as(host).delete(`${QUIZZES}/${quiz._id}`);
    expect((await next(host, game)).question.text).toBe('Hol volt az első tábor?');
  });
});

describe('the games’ list and the leaderboard', () => {
  it('show the finished games with their winners, the live ones to join - not the ones called off', async () => {
    const host = await createMember({ name: 'Zoli' });
    const anna = await createMember({ name: 'Anna' });
    const bela = await createMember({ name: 'Béla' });
    const one = { questions: [{ text: 'Mi?', answers: ['a', 'b'], correct: 0 }] };

    const played = await startGame(host, [anna, bela], one);
    await next(host, played);
    await answer(bela, played, 0);
    await answer(anna, played, 1);
    await next(host, played);

    const live = await startGame(host, [anna], one);
    const off = await startGame(host, [anna], one);
    const gone = (await as(host).post(`${GAMES}/${off._id}/abandon`)).body.data.game;
    expect(gone).toMatchObject({ status: 'abandoned', pin: null });

    const { games } = (await as(await createGuest()).get(GAMES)).body.data;
    expect(games.map((g) => [g._id, g.status])).toEqual([
      [live._id, 'lobby'],
      [played._id, 'finished'],
    ]);
    expect(games[0]).toMatchObject({ playerCount: 1, winners: [], host: { name: 'Zoli' } });
    expect(games[1].winners.map((w) => [w.place, w.name])).toEqual([
      [1, 'Béla'],
      [2, 'Anna'],
    ]);

    // The best results of all time: who, in which game, how many points.
    const { results } = (await as(anna).get('/jatekok/quiz/leaderboard')).body.data;
    expect(results.map((r) => [r.name, r.title, r.gameId, r.place, r.points > 500])).toEqual([
      ['Béla', 'Táborok', played._id, 1, true],
      ['Anna', 'Táborok', played._id, 2, false],
    ]);
  });
});

describe('a picture question', () => {
  // A big "phone photo" (3000x2000) carrying a GPS location in its EXIF.
  const phonePhoto = () =>
    sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#5a8' } })
      .jpeg()
      .withExif({ IFD0: { Make: 'TestPhone' }, IFD3: { GPSLatitudeRef: 'N' } })
      .toBuffer();

  const uploadPicture = async (user, { buffer, type = 'image/jpeg' } = {}) =>
    request(app)
      .post('/jatekok/quiz/images')
      .set(asUser(user))
      .attach('image', buffer ?? (await phonePhoto()), { filename: 'x.jpg', contentType: type });

  const pictureQuiz = (image) => ({
    questions: [
      { type: 'picture', text: 'Hol készült?', image, answers: ['Mátra', 'Bükk'], correct: 0 },
    ],
  });

  it('takes an uploaded picture: shrunk to 1600 px, its EXIF (GPS) dropped, served to whoever is logged in', async () => {
    const anna = await createMember();
    const res = await uploadPicture(anna);
    expect(res.status, res.body.message).toBe(201);
    const { image } = res.body.data;
    expect(image).toMatch(/^[0-9a-f]{24}$/);

    const meta = await sharp(fs.readFileSync(quizImagePath(image))).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 1600, height: 1067 });
    expect(meta.exif).toBeUndefined();

    const url = `/jatekok/quiz/images/${image}`;
    const got = await as(await createGuest()).get(url);
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toBe('image/webp');
    expect((await request(app).get(url)).status).toBe(401);
    expect((await as(anna).get('/jatekok/quiz/images/..%2Fx')).status).toBe(404);
    expect((await as(anna).get(`/jatekok/quiz/images/${'0'.repeat(24)}`)).status).toBe(404);
  });

  it('refuses what is not a picture', async () => {
    const anna = await createMember();
    expect((await as(anna).post('/jatekok/quiz/images')).status).toBe(400);
    const text = await uploadPicture(anna, { buffer: Buffer.from('szia'), type: 'text/plain' });
    expect(text.status).toBe(400);
    const fake = await uploadPicture(anna, { buffer: Buffer.from('nem kép') });
    expect(fake.status).toBe(400);
  });

  it('copies a photo of a tour’s album - but not a restricted one', async () => {
    const anna = await createMember();
    const tour = await createTour();
    const folder = path.join(process.env.PHOTOS_ROOT, 'teszt-tabor');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'IMG_1.jpg'), await phonePhoto());
    fs.writeFileSync(path.join(folder, 'IMG_2.jpg'), await phonePhoto());
    await Tour.updateOne(
      { _id: tour._id },
      {
        sourceFolder: 'teszt-tabor',
        images: [{ filename: 'IMG_1.jpg' }, { filename: 'IMG_2.jpg', restricted: true }],
      },
    );
    const pick = (filename, tourId = String(tour._id)) =>
      as(anna).post('/jatekok/quiz/images/from-tour', { tourId, filename });

    const res = await pick('IMG_1.jpg');
    expect(res.status, res.body.message).toBe(201);
    expect(fs.existsSync(quizImagePath(res.body.data.image))).toBe(true);

    expect((await pick('IMG_2.jpg')).status).toBe(404);
    expect((await pick('nincs.jpg')).status).toBe(404);
    expect((await pick('../teszt-tabor/IMG_1.jpg')).status).toBe(404);
    expect((await pick('IMG_1.jpg', 'nem-id')).status).toBe(404);
  });

  it('is shown in the game, and its picture is kept while a quiz or a game needs it', async () => {
    const host = await createMember();
    const anna = await createMember();
    const first = (await uploadPicture(host)).body.data.image;
    const second = (await uploadPicture(host)).body.data.image;

    // A picture that isn't there (or isn't a picture's name) won't do.
    expect((await as(host).post(QUIZZES, quizBody(pictureQuiz('0'.repeat(24))))).status).toBe(400);
    expect((await as(host).post(QUIZZES, quizBody(pictureQuiz('../x')))).status).toBe(400);

    const quiz = await createQuiz(host, pictureQuiz(first));
    expect(quiz.questions[0]).toMatchObject({ type: 'picture', image: first });
    // A picture question without a picture won't do either.
    expect((await as(host).post(QUIZZES, quizBody(pictureQuiz(null)))).status).toBe(400);
    const game = (await as(host).post(`${QUIZZES}/${quiz._id}/games`)).body.data.game;
    await as(anna).post(`${GAMES}/${game._id}/join`);
    expect((await next(host, game)).question).toMatchObject({ type: 'picture', image: first });

    // The quiz gets another picture: the game still on keeps the first.
    await as(host).put(`${QUIZZES}/${quiz._id}`, quizBody(pictureQuiz(second)));
    expect(fs.existsSync(quizImagePath(first))).toBe(true);

    // The quiz deleted: its own picture goes, nothing shows it any more.
    await as(host).delete(`${QUIZZES}/${quiz._id}`);
    expect(fs.existsSync(quizImagePath(second))).toBe(false);
    expect(fs.existsSync(quizImagePath(first))).toBe(true);
  });
});
