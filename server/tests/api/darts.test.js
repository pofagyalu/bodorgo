import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createGuest, createMember } from '../helpers/factories.js';
import DartsGame from '../../src/models/dartsGameModel.js';
import { EDIT_WINDOW_MS } from '../../src/controllers/dartsController.js';

// Móka → Darts over HTTP (the rules themselves: tests/unit/dartsX01.test.js).

// While Móka is being built only the role manager gets in (jatekok/access.js).
const createOwner = () => createAdmin({ name: 'Nagy Zoli', canManageRoles: true });

const GAMES = '/jatekok/darts/games';

// "T20" / "D16" / "5" / "BULL" / "-" (a miss) → a dart.
const dart = (s) => {
  if (s === '-') return { segment: 0, multiplier: 0 };
  if (s === 'BULL') return { segment: 25, multiplier: 2 };
  const multiplier = { T: 3, D: 2 }[s[0]] ?? 1;
  return { segment: Number(multiplier === 1 ? s : s.slice(1)), multiplier };
};

const start = (user, body) => request(app).post(GAMES).set(asUser(user)).send(body);

// Throws the darts one by one; answers the game after the last one.
async function throwDarts(user, gameId, s) {
  let res;
  for (const d of s.split(/\s+/)) {
    res = await request(app).post(`${GAMES}/${gameId}/throws`).set(asUser(user)).send(dart(d));
    expect(res.status, `${d}: ${res.body.message}`).toBe(200);
  }
  return res.body.data.game;
}

describe('Móka: who gets in', () => {
  it('only the role manager, for now', async () => {
    expect((await request(app).get(GAMES)).status).toBe(401);
    for (const user of [await createAdmin(), await createMember(), await createGuest()]) {
      expect((await request(app).get(GAMES).set(asUser(user))).status).toBe(403);
      expect((await start(user, { players: [{ guestName: 'Peti' }] })).status).toBe(403);
      expect((await request(app).get('/jatekok/players').set(asUser(user))).status).toBe(403);
    }
    expect(
      (
        await request(app)
          .get(GAMES)
          .set(asUser(await createOwner()))
      ).status,
    ).toBe(200);
  });
});

describe('darts games', () => {
  it('lists the people to pick from, by the name the app shows', async () => {
    const owner = await createOwner();
    await createMember({ name: 'Kiss Anna', username: 'anna' });
    await createGuest({ name: 'Árvai Béla' });
    const res = await request(app).get('/jatekok/players').set(asUser(owner));
    expect(res.body.data.players.map((p) => p.name)).toEqual(['anna', 'Árvai Béla', 'Nagy Zoli']);
  });

  it('starts a game with users and guests, on the defaults', async () => {
    const owner = await createOwner();
    const anna = await createMember({ name: 'Kiss Anna', username: 'anna' });
    const res = await start(owner, {
      players: [{ userId: String(anna._id) }, { guestName: '  Peti ' }],
    });
    expect(res.status).toBe(201);
    const { game } = res.body.data;
    expect(game).toMatchObject({
      type: 'x01',
      status: 'in_progress',
      options: { startScore: 301, outMode: 'single', playUntil: 'all' },
      createdBy: { name: 'Nagy Zoli' },
      turns: [],
      next: { playerIdx: 0, round: 1, dartsLeft: 3, checkout: null },
      canEdit: true,
    });
    expect(game.players.map((p) => [p.name, p.userId, p.remaining])).toEqual([
      ['anna', String(anna._id), 301],
      ['Peti', null, 301],
    ]);
  });

  it('refuses a game that makes no sense', async () => {
    const owner = await createOwner();
    const me = { userId: String(owner._id) };
    const bad = [
      {},
      { players: [] },
      { players: [{ guestName: '   ' }] },
      { players: [{ guestName: 'x'.repeat(31) }] },
      { players: [me, me] },
      { players: [{ userId: '507f1f77bcf86cd799439011' }] },
      { players: [me], startScore: 501 },
      { players: [me], outMode: 'triple' },
      { players: [me], playUntil: 'never' },
      { players: Array.from({ length: 17 }, (_, i) => ({ guestName: `V${i}` })) },
    ];
    for (const body of bad) {
      expect((await start(owner, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await DartsGame.countDocuments()).toBe(0);
  });

  it('plays a game through: busts, the way out, the placings, the end', async () => {
    const owner = await createOwner();
    const res = await start(owner, {
      startScore: 101,
      players: [{ userId: String(owner._id) }, { guestName: 'Peti' }],
    });
    const id = res.body.data.game._id;

    // Zoli: 80, 21 left. Peti: three misses.
    let game = await throwDarts(owner, id, 'T20 20 -  - - -');
    expect(game.next).toMatchObject({ playerIdx: 0, round: 2, dartsLeft: 3 });
    expect(game.next.checkout).toEqual([dart('T7')]);

    // Zoli busts on a T20; Peti misses again; Zoli checks out.
    game = await throwDarts(owner, id, 'T20  - - -  T7');
    expect(game.turns[2]).toMatchObject({ bust: true, points: 0, startScore: 21 });
    expect(game.players[0]).toMatchObject({ remaining: 0, position: 1, positionFinal: false });
    expect(game.status).toBe('in_progress');
    expect(game.next.playerIdx).toBe(1);

    // Peti has the round too; then it's over.
    game = await throwDarts(owner, id, '1 1 1');
    expect(game).toMatchObject({ status: 'finished', next: null, placings: [0, 1] });
    expect(game.finishedAt).toBeTruthy();
    expect(game.players[0]).toMatchObject({ darts: 5, points: 101, highestTurn: 80 });
    expect(game.players[1]).toMatchObject({ remaining: 98, position: 2 });

    const more = await request(app)
      .post(`${GAMES}/${id}/throws`)
      .set(asUser(owner))
      .send(dart('1'));
    expect(more.status).toBe(400);
  });

  it('refuses a dart that does not exist', async () => {
    const owner = await createOwner();
    const id = (await start(owner, { players: [{ guestName: 'Peti' }] })).body.data.game._id;
    for (const body of [{ segment: 25, multiplier: 3 }, { segment: 21, multiplier: 1 }, {}]) {
      const res = await request(app).post(`${GAMES}/${id}/throws`).set(asUser(owner)).send(body);
      expect(res.status).toBe(400);
    }
    expect((await request(app).get(`${GAMES}/nonsense`).set(asUser(owner))).status).toBe(404);
  });

  it('takes the last dart back - a finished game is on again', async () => {
    const owner = await createOwner();
    const id = (await start(owner, { startScore: 101, players: [{ guestName: 'Peti' }] })).body.data
      .game._id;
    let game = await throwDarts(owner, id, 'T20 20 T7');
    expect(game.status).toBe('finished');

    const res = await request(app).delete(`${GAMES}/${id}/throws/last`).set(asUser(owner));
    game = res.body.data.game;
    expect(game).toMatchObject({ status: 'in_progress', finishedAt: null });
    expect(game.players[0].remaining).toBe(21);
    expect(game.next).toMatchObject({ playerIdx: 0, round: 1, dartsLeft: 1 });
  });

  it('corrects an earlier turn, keeping what it was', async () => {
    const owner = await createOwner();
    const id = (
      await start(owner, {
        startScore: 101,
        players: [{ guestName: 'Peti' }, { guestName: 'Gabi' }],
      })
    ).body.data.game._id;
    await throwDarts(owner, id, 'T20 20 -  1 1 1  1');

    const edit = (turnIdx, throws, query = '') =>
      request(app)
        .patch(`${GAMES}/${id}/turns/${turnIdx}${query}`)
        .set(asUser(owner))
        .send({ throws: throws.split(' ').map(dart) });

    // The same darts again: nothing is corrected.
    const same = await edit(0, 'T20 20 -');
    expect(same.body.data.game.turns[0].editedAt).toBeNull();

    // A preview shows the game as it would be, and stores nothing.
    const preview = await edit(0, 'T20 5 -', '?preview=true');
    expect(preview.body.data.game.players[0].remaining).toBe(35);
    expect((await DartsGame.findById(id)).turns[0].throws[1].segment).toBe(20);

    // Peti's first turn was 60 + 5, not 60 + 20.
    const res = await edit(0, 'T20 5 -');
    expect(res.status).toBe(200);
    const { game } = res.body.data;
    expect(game.turns[0]).toMatchObject({
      points: 65,
      previousThrows: 'T20 20 -'.split(' ').map(dart),
    });
    expect(game.turns[0].editedAt).toBeTruthy();
    expect(game.players[0].remaining).toBe(35);
    const stored = await DartsGame.findById(id);
    expect(String(stored.turns[0].editedBy)).toBe(String(owner._id));

    // Two darts aren't a whole turn; an unknown turn or dart is refused.
    expect((await edit(0, 'T20 5')).status).toBe(400);
    expect((await edit(9, '1 1 1')).status).toBe(404);
    expect((await edit(0, '1 1 1 1')).status).toBe(400);
    // ...but the open last turn may stay open.
    expect((await edit(2, '5')).status).toBe(200);
  });

  it('an abandoned game stays in the list, but is closed', async () => {
    const owner = await createOwner();
    const id = (await start(owner, { players: [{ guestName: 'Peti' }] })).body.data.game._id;
    await start(owner, { players: [{ guestName: 'Gabi' }] });

    const res = await request(app).post(`${GAMES}/${id}/abandon`).set(asUser(owner));
    expect(res.body.data.game).toMatchObject({ status: 'abandoned', canEdit: false });
    const more = await request(app)
      .post(`${GAMES}/${id}/throws`)
      .set(asUser(owner))
      .send(dart('1'));
    expect(more.status).toBe(400);

    const all = await request(app).get(GAMES).set(asUser(owner));
    expect(all.body.data.games.map((g) => g.players[0].name)).toEqual(['Gabi', 'Peti']);
    expect(all.body.data.games[0].turns).toBeUndefined();
    const on = await request(app).get(`${GAMES}?status=in_progress`).set(asUser(owner));
    expect(on.body.data.games.map((g) => g.players[0].name)).toEqual(['Gabi']);
  });

  it('a game is only its own people’s - the leaderboard is everyone’s', async () => {
    const owner = await createOwner();
    const anna = await createMember({ name: 'Kiss Anna', username: 'anna' });
    // Someone else who is in Móka (as everyone will be, once it opens).
    const stranger = await createMember({ canManageRoles: true });
    const id = (
      await start(owner, {
        startScore: 101,
        players: [
          { userId: String(owner._id) },
          { userId: String(anna._id) },
          { guestName: 'Peti' },
        ],
      })
    ).body.data.game._id;
    // Zoli checks out 101 at once; the others have their round - Anna is 2nd.
    await throwDarts(owner, id, 'T20 20 T7  T20 - -  1 1 1');
    await throwDarts(owner, id, '20 20 1'); // Anna finishes in round 2
    await throwDarts(owner, id, '1 1 1');

    expect((await request(app).get(`${GAMES}/${id}`).set(asUser(stranger))).status).toBe(404);
    const undo = await request(app).delete(`${GAMES}/${id}/throws/last`).set(asUser(stranger));
    expect(undo.status).toBe(404);
    const theirs = await request(app).get(GAMES).set(asUser(stranger));
    expect(theirs.body.data.games).toEqual([]);
    expect((await request(app).get(GAMES).set(asUser(owner))).body.data.games).toHaveLength(1);

    // The guest isn't on the leaderboard.
    const board = await request(app).get('/jatekok/darts/leaderboard').set(asUser(stranger));
    expect(board.body.data.players).toMatchObject([
      {
        name: 'Nagy Zoli',
        games: 1,
        firsts: 1,
        seconds: 0,
        average: 101,
        highestTurn: 101,
        highestCheckout: 101,
        count180: 0,
      },
      { name: 'anna', games: 1, firsts: 0, seconds: 1, highestTurn: 60, highestCheckout: 41 },
    ]);
    expect(board.body.data.players).toHaveLength(2);
  });

  it('after its end a game can be corrected for half an hour - later only by an admin in it', async () => {
    // Someone who is in Móka but not an admin: once it opens to everyone.
    const owner = await createOwner();
    const player = await createMember({ canManageRoles: true });
    const id = (await start(player, { startScore: 101, players: [{ userId: String(owner._id) }] }))
      .body.data.game._id;
    await throwDarts(player, id, 'T20 20 T7');
    await DartsGame.updateOne(
      { _id: id },
      { finishedAt: new Date(Date.now() - EDIT_WINDOW_MS - 1000) },
    );

    const late = await request(app).delete(`${GAMES}/${id}/throws/last`).set(asUser(player));
    expect(late.status).toBe(403);
    const seen = await request(app).get(`${GAMES}/${id}`).set(asUser(player));
    expect(seen.body.data.game.canEdit).toBe(false);
    const admin = await request(app).delete(`${GAMES}/${id}/throws/last`).set(asUser(owner));
    expect(admin.status).toBe(200);
  });

  it('the players can end a game any time - undo takes that back', async () => {
    const owner = await createOwner();
    const id = (
      await start(owner, {
        startScore: 101,
        players: [{ guestName: 'Peti' }, { guestName: 'Gabi' }, { guestName: 'Zsuzsi' }],
      })
    ).body.data.game._id;
    // Peti checks out; Gabi has 41 left, Zsuzsi 98.
    await throwDarts(owner, id, 'T20 20 T7  T20 - -  1 1 1');

    const end = await request(app).post(`${GAMES}/${id}/finish`).set(asUser(owner));
    expect(end.body.data.game).toMatchObject({
      status: 'finished',
      ended: true,
      next: null,
      placings: [0, 1, 2],
    });
    expect(end.body.data.game.players.map((p) => p.position)).toEqual([1, 2, 3]);
    // Over is over.
    expect((await request(app).post(`${GAMES}/${id}/finish`).set(asUser(owner))).status).toBe(400);
    const more = await request(app)
      .post(`${GAMES}/${id}/throws`)
      .set(asUser(owner))
      .send(dart('1'));
    expect(more.status).toBe(400);

    // Undo: the game is on again as it stood - no dart is lost.
    const back = await request(app).delete(`${GAMES}/${id}/throws/last`).set(asUser(owner));
    expect(back.body.data.game).toMatchObject({ status: 'in_progress', ended: false });
    expect(back.body.data.game.turns).toHaveLength(3);
    expect(back.body.data.game.next).toMatchObject({ playerIdx: 1, round: 2 });
  });

  it('plays Cricket: marks, points, the finish', async () => {
    const owner = await createOwner();
    const res = await start(owner, {
      type: 'cricket',
      players: [{ userId: String(owner._id) }, { guestName: 'Peti' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.game).toMatchObject({ type: 'cricket', next: { checkout: null } });
    const id = res.body.data.game._id;

    // Zoli closes 20 and scores 60 on it; Peti hits a 20 and misses.
    let game = await throwDarts(owner, id, 'T20 T20 -  20 - -');
    expect(game.players[0]).toMatchObject({ points: 60, average: 6 });
    expect(game.players[0].marks).toMatchObject({ 20: 3, 19: 0 });
    expect(game.players[0].remaining).toBeUndefined();
    expect(game.players[1].marks).toMatchObject({ 20: 1 });
    expect(game.turns[0]).toMatchObject({ marks: 6, points: 60 });

    // Zoli closes the rest: the game is over, Peti is second.
    game = await throwDarts(owner, id, 'T19 T18 T17  - - -  T16 T15 BULL  - - -  25');
    expect(game).toMatchObject({ status: 'finished', placings: [0, 1] });

    // Each kind of game has its own leaderboard.
    const board = (query) =>
      request(app).get(`/jatekok/darts/leaderboard${query}`).set(asUser(owner));
    expect((await board('?type=cricket')).body.data.players).toMatchObject([
      { name: 'Nagy Zoli', games: 1, firsts: 1, highestTurn: 9, highestCheckout: 0 },
    ]);
    expect((await board('')).body.data.players).toEqual([]);
  });

  it('the X01 leaderboard can be narrowed to one starting score', async () => {
    const owner = await createOwner();
    const id = (await start(owner, { startScore: 101, players: [{ userId: String(owner._id) }] }))
      .body.data.game._id;
    await throwDarts(owner, id, 'T20 20 T7');
    const board = (query) =>
      request(app).get(`/jatekok/darts/leaderboard${query}`).set(asUser(owner));
    expect((await board('?type=x01')).body.data.players).toHaveLength(1);
    expect((await board('?type=x01&startScore=101')).body.data.players).toHaveLength(1);
    expect((await board('?type=x01&startScore=301')).body.data.players).toEqual([]);
  });
});
