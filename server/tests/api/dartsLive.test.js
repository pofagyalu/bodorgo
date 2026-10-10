import http from 'http';
import request from 'supertest';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createMember } from '../helpers/factories.js';
import registerChatHandlers from '../../src/chat/chatSocket.js';
import registerDartsHandlers from '../../src/jatekok/darts/dartsSocket.js';

// Móka → Darts, live (jatekok/darts/dartsSocket.js): a real Socket.IO
// server on a random port, with the same stand-in session as the HTTP tests
// (x-test-user header).
const GAMES = '/jatekok/darts/games';
let server;
let url;
const sockets = [];

beforeAll(async () => {
  server = http.createServer(app);
  const io = new Server(server);
  io.engine.use((req, res, next) => {
    const raw = req.headers['x-test-user'];
    req.session = { user: raw ? JSON.parse(raw) : undefined };
    next();
  });
  registerChatHandlers(io);
  registerDartsHandlers(io);
  await new Promise((resolve) => server.listen(0, resolve));
  url = `http://localhost:${server.address().port}`;
});

afterEach(() => {
  sockets.splice(0).forEach((s) => s.disconnect());
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

async function connect(user) {
  const socket = ioClient(url, {
    extraHeaders: user ? asUser(user) : {},
    transports: ['websocket', 'polling'],
  });
  sockets.push(socket);
  await new Promise((resolve) => socket.on('connect', resolve));
  return socket;
}

// Whether they got into the game's channel.
const join = (socket, gameId) =>
  new Promise((resolve) => socket.emit('join-darts', { gameId }, resolve));

// Everything a socket hears about darts games from here on.
const heard = (socket) => {
  const news = [];
  socket.on('darts-game', (n) => news.push(n));
  return news;
};

const until = async (check) => {
  for (let i = 0; i < 100 && !check(); i += 1) await new Promise((r) => setTimeout(r, 10));
};

describe('darts, live', () => {
  it('every change is announced to the game’s people - and to nobody else', async () => {
    const zoli = await createMember({ name: 'Nagy Zoli' });
    const anna = await createMember({ name: 'Kiss Anna' });
    const stranger = await createMember();
    const started = await request(app)
      .post(GAMES)
      .set(asUser(zoli))
      .send({ players: [{ userId: String(zoli._id) }, { userId: String(anna._id) }] });
    const id = started.body.data.game._id;
    expect(started.body.data.game.updatedAt).toBeTruthy();

    const [hers, theirs, nobodys] = [
      await connect(anna),
      await connect(stranger),
      await connect(null),
    ];
    expect(await join(hers, id)).toBe(true);
    expect(await join(theirs, id)).toBe(false);
    expect(await join(nobodys, id)).toBe(false);
    expect(await join(hers, 'nonsense')).toBe(false);
    const [annaNews, strangerNews, nobodyNews] = [hers, theirs, nobodys].map(heard);

    // A dart, the dart taken back, a dart again, and the game given up.
    const as = (method, path, body) =>
      request(app)[method](`${GAMES}/${id}${path}`).set(asUser(zoli)).send(body);
    const thrown = await as('post', '/throws', { segment: 20, multiplier: 3 });
    await as('delete', '/throws/last');
    await as('post', '/throws', { segment: 5, multiplier: 1 });
    // A preview stores nothing: no news.
    await as('patch', '/turns/0?preview=true', { throws: [{ segment: 1, multiplier: 1 }] });
    await as('post', '/abandon');

    await until(() => annaNews.length >= 4);
    expect(annaNews).toHaveLength(4);
    // The news carries the game's own time stamp: whoever made the change
    // knows they already have it.
    expect(annaNews[0]).toEqual({ gameId: id, updatedAt: thrown.body.data.game.updatedAt });
    expect(strangerNews).toEqual([]);
    expect(nobodyNews).toEqual([]);

    // Once left, nothing more arrives.
    hers.emit('leave-darts', { gameId: id });
    const other = await request(app)
      .post(GAMES)
      .set(asUser(zoli))
      .send({ players: [{ userId: String(anna._id) }] });
    await request(app)
      .post(`${GAMES}/${other.body.data.game._id}/throws`)
      .set(asUser(zoli))
      .send({ segment: 1, multiplier: 1 });
    await new Promise((r) => setTimeout(r, 100));
    expect(annaNews).toHaveLength(4);
  });
});
