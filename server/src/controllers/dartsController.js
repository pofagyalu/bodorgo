import mongoose from 'mongoose';
import DartsGame, { GAME_TYPES } from '../models/dartsGameModel.js';
import User from '../models/userModel.js';
import AppError from '../utils/appError.js';
import * as x01 from '../jatekok/darts/x01.js';
import * as cricket from '../jatekok/darts/cricket.js';

// Móka → Darts. One phone keeps the score: every dart is sent here, and
// the answer is the whole game as it now stands (gameView) - the rules
// live only on the server (jatekok/darts: x01.js, cricket.js).

// Each kind of game has its own rules; all are replayed the same way.
const ENGINES = { x01, cricket };

const MAX_PLAYERS = 16;
const MAX_GUEST_NAME = 30;
// How long after its end a game can still be corrected by its players;
// after that only by an admin among them.
export const EDIT_WINDOW_MS = 30 * 60 * 1000;

const PLAYER_SELECT = 'name username photoUpdatedAt';
const refId = (ref) => String(ref?._id ?? ref);
const isAdmin = (user) => user.role === 'admin';
// What the app calls someone: their username, or their name without one.
const shownName = (user) => user?.username || user?.name || 'Ismeretlen';

// A game is its own people's: whoever started it or plays in it. Nobody
// else sees it (only what it adds to the leaderboard) - an admin neither.
const takesPart = (game, user) =>
  refId(game.createdBy) === refId(user) ||
  game.players.some((p) => p.user && refId(p.user) === refId(user));
const myGames = (user) => ({ $or: [{ createdBy: user._id }, { 'players.user': user._id }] });

// The game, if it's this user's to see - null otherwise.
async function loadGame(id, user) {
  if (!mongoose.isValidObjectId(id)) return null;
  const game = await DartsGame.findById(id)
    .populate({ path: 'players.user', select: PLAYER_SELECT })
    .populate({ path: 'createdBy', select: 'name username' });
  return game && takesPart(game, user) ? game : null;
}

// What the rules need to know about a game: its options, and whether the
// players have ended it (the "Játék befejezése" button).
const rulesOf = (game) => ({
  startScore: game.options.startScore,
  outMode: game.options.outMode,
  playUntil: game.options.playUntil,
  ended: game.ended,
});
const storedTurns = (game) => game.turns.map((t) => t.toObject());
const replayGame = (game) =>
  ENGINES[game.type].replay(game.players.length, rulesOf(game), storedTurns(game));

// The game's people may throw, undo and correct - while it's on, and for a
// while after its end; later only those of them who are admins.
function canEdit(game, user) {
  if (game.status === 'abandoned' || !takesPart(game, user)) return false;
  if (isAdmin(user)) return true;
  return game.status !== 'finished' || Date.now() - game.finishedAt.getTime() < EDIT_WINDOW_MS;
}

// The players as the game stands: who they are and how they're doing.
// `average` is per three darts: points in X01, marks in Cricket.
const playerViews = (game, state) =>
  game.players.map((p, idx) => {
    const s = state.players[idx];
    const turns = state.turns.filter((t) => t.playerIdx === idx);
    return {
      idx,
      userId: p.user?._id ?? null,
      name: p.user ? shownName(p.user) : p.guestName,
      photoUpdatedAt: p.user?.photoUpdatedAt ?? null,
      // X01: what's left. Cricket: the hits on each number (three close it).
      ...(game.type === 'cricket' ? { marks: s.marks } : { remaining: s.remaining }),
      darts: s.darts,
      points: s.points,
      average: s.average,
      highestTurn: Math.max(0, ...turns.map((t) => t.points)),
      position: s.position,
      positionFinal: s.positionFinal,
    };
  });

const baseView = (game, state, user) => ({
  _id: game._id,
  type: game.type,
  options: game.options,
  status: game.status,
  // The players ended it themselves, before the rules did.
  ended: game.ended,
  createdBy: { _id: refId(game.createdBy), name: shownName(game.createdBy) },
  createdAt: game.createdAt,
  finishedAt: game.finishedAt,
  players: playerViews(game, state),
  // Player indexes, best first: those who finished - and everyone once
  // it's over.
  placings: state.placings,
  canEdit: canEdit(game, user),
});

// The whole game for the game screen: every turn worked out, and who
// throws next - in X01 with the way out, if they can finish in this turn.
function gameView(game, user) {
  const state = replayGame(game);
  const next = state.next && {
    ...state.next,
    checkout:
      game.type === 'x01'
        ? x01.checkoutHint(
            state.players[state.next.playerIdx].remaining,
            game.options.outMode,
            state.next.dartsLeft,
          )
        : null,
  };
  return {
    ...baseView(game, state, user),
    turns: state.turns.map((t) => ({
      playerIdx: t.playerIdx,
      round: t.round,
      throws: t.throws,
      startScore: t.startScore,
      points: t.points,
      ...(game.type === 'cricket' && { marks: t.marks }),
      bust: t.bust,
      finished: t.finished,
      short: t.short,
      editedAt: t.editedAt ?? null,
      previousThrows: t.previousThrows ?? null,
    })),
    next,
  };
}

// Stores the game as the rules now see it: the turns that still count,
// and whether it's over (a correction or an undo can reopen it).
async function saveState(game, state) {
  applyState(game, state);
  await game.save();
}

// The same on the game in memory only - saveState stores it; a preview
// (editTurn) just answers it.
function applyState(game, state) {
  game.turns = state.turns.map((t) => ({
    playerIdx: t.playerIdx,
    throws: t.throws,
    enteredBy: t.enteredBy ?? null,
    editedBy: t.editedBy ?? null,
    editedAt: t.editedAt ?? null,
    previousThrows: t.previousThrows,
  }));
  if (state.over && game.status !== 'finished') {
    game.status = 'finished';
    game.finishedAt = new Date();
  } else if (!state.over) {
    game.status = 'in_progress';
    game.finishedAt = null;
  }
}

// The game to change, or the error why not.
async function gameToEdit(req) {
  const game = await loadGame(req.params.id, req.user);
  if (!game) throw new AppError('Nincs ilyen játék.', 404);
  if (game.status === 'abandoned') throw new AppError('Ez a játék félbemaradt.', 400);
  if (!canEdit(game, req.user)) {
    throw new AppError('Ezt a játékot már csak admin javíthatja.', 403);
  }
  return game;
}

const sendGame = (res, game, user, code = 200) =>
  res.status(code).json({ status: 'success', data: { game: gameView(game, user) } });

const cleanThrow = (t) => ({ segment: t?.segment, multiplier: t?.multiplier });

// GET /jatekok/players - everyone who can be picked as a player.
export const getPlayers = async (req, res) => {
  const users = await User.find().select(PLAYER_SELECT).lean();
  const players = users
    .map((u) => ({ _id: u._id, name: shownName(u), photoUpdatedAt: u.photoUpdatedAt ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  res.status(200).json({ status: 'success', data: { players } });
};

// POST /jatekok/darts/games - a new game, already started.
export const createGame = async (req, res) => {
  const {
    type = 'x01',
    startScore = 301,
    outMode = 'single',
    playUntil = 'all',
    players,
  } = req.body ?? {};
  if (
    !GAME_TYPES.includes(type) ||
    !x01.START_SCORES.includes(startScore) ||
    !x01.OUT_MODES.includes(outMode) ||
    !x01.PLAY_UNTIL.includes(playUntil)
  ) {
    throw new AppError('Ismeretlen játékbeállítás.', 400);
  }
  if (!Array.isArray(players) || players.length < 1 || players.length > MAX_PLAYERS) {
    throw new AppError(`A játékhoz 1-${MAX_PLAYERS} játékos kell.`, 400);
  }

  const cleaned = players.map((p) => {
    if (typeof p?.userId === 'string' && mongoose.isValidObjectId(p.userId)) {
      return { user: p.userId };
    }
    const guestName = typeof p?.guestName === 'string' ? p.guestName.trim() : '';
    if (!guestName || guestName.length > MAX_GUEST_NAME) {
      throw new AppError(`A vendég neve 1-${MAX_GUEST_NAME} karakter lehet.`, 400);
    }
    return { guestName };
  });
  const userIds = cleaned.filter((p) => p.user).map((p) => p.user);
  if (new Set(userIds).size !== userIds.length) {
    throw new AppError('Valaki kétszer szerepel a játékosok között.', 400);
  }
  if ((await User.countDocuments({ _id: { $in: userIds } })) !== userIds.length) {
    throw new AppError('Nincs ilyen felhasználó.', 400);
  }

  const created = await DartsGame.create({
    createdBy: req.user._id,
    type,
    // The X01 options mean nothing in Cricket - left at their defaults.
    ...(type === 'x01' && { options: { startScore, outMode, playUntil } }),
    players: cleaned,
  });
  sendGame(res, await loadGame(created._id, req.user), req.user, 201);
};

// GET /jatekok/darts/games?status= - my games (started or played in),
// newest first, without the turns.
export const getGames = async (req, res) => {
  const filter = myGames(req.user);
  if (['in_progress', 'finished', 'abandoned'].includes(req.query.status)) {
    filter.status = req.query.status;
  }
  const games = await DartsGame.find(filter)
    .sort('-createdAt')
    .limit(100)
    .populate({ path: 'players.user', select: PLAYER_SELECT })
    .populate({ path: 'createdBy', select: 'name username' });
  res.status(200).json({
    status: 'success',
    data: { games: games.map((g) => baseView(g, replayGame(g), req.user)) },
  });
};

// GET /jatekok/darts/games/:id
export const getGame = async (req, res) => {
  const game = await loadGame(req.params.id, req.user);
  if (!game) throw new AppError('Nincs ilyen játék.', 404);
  sendGame(res, game, req.user);
};

// GET /jatekok/darts/leaderboard?type=&startScore= - everyone's numbers
// from every finished game of one kind (the games themselves stay their
// players'): who stood on the podium how often, and how they throw. Guests
// - only named, not users - aren't in it. Best first: the most wins, then
// 2nd and 3rd places, then the average.
export const getLeaderboard = async (req, res) => {
  const type = GAME_TYPES.includes(req.query.type) ? req.query.type : 'x01';
  const filter = { status: 'finished', type };
  const startScore = Number(req.query.startScore);
  if (type === 'x01' && x01.START_SCORES.includes(startScore)) {
    filter['options.startScore'] = startScore;
  }
  const games = await DartsGame.find(filter).populate({
    path: 'players.user',
    select: PLAYER_SELECT,
  });

  const rows = new Map();
  for (const game of games) {
    const state = replayGame(game);
    game.players.forEach((p, idx) => {
      if (!p.user) return;
      const key = refId(p.user);
      if (!rows.has(key)) {
        rows.set(key, {
          userId: p.user._id,
          name: shownName(p.user),
          photoUpdatedAt: p.user.photoUpdatedAt ?? null,
          games: 0,
          places: [0, 0, 0],
          darts: 0,
          // What the average is of: points in X01, marks in Cricket.
          counted: 0,
          highestTurn: 0,
          highestCheckout: 0,
          count180: 0,
        });
      }
      const row = rows.get(key);
      const s = state.players[idx];
      const turns = state.turns.filter((t) => t.playerIdx === idx);
      // A turn's worth: its points in X01, its marks in Cricket.
      const worth = (t) => (type === 'cricket' ? t.marks : t.points);
      row.games += 1;
      if (s.position <= 3) row.places[s.position - 1] += 1;
      row.darts += s.darts;
      row.counted += type === 'cricket' ? s.marksTotal : s.points;
      row.highestTurn = Math.max(row.highestTurn, ...turns.map(worth));
      if (type === 'x01') {
        row.highestCheckout = Math.max(
          row.highestCheckout,
          ...turns.filter((t) => t.finished).map((t) => t.points),
        );
        row.count180 += turns.filter((t) => t.points === 180).length;
      }
    });
  }

  const players = [...rows.values()]
    .map(({ places, darts, counted, ...row }) => ({
      ...row,
      firsts: places[0],
      seconds: places[1],
      thirds: places[2],
      average: darts ? Math.round((counted / darts) * 3 * 100) / 100 : null,
    }))
    .sort(
      (a, b) =>
        b.firsts - a.firsts ||
        b.seconds - a.seconds ||
        b.thirds - a.thirds ||
        (b.average ?? 0) - (a.average ?? 0) ||
        a.name.localeCompare(b.name, 'hu'),
    );
  res.status(200).json({ status: 'success', data: { players } });
};

// POST /jatekok/darts/games/:id/throws - the next dart, by whoever is next.
export const addThrow = async (req, res) => {
  const game = await gameToEdit(req);
  const t = cleanThrow(req.body);
  if (!x01.isValidThrow(t)) throw new AppError('Ilyen dobás nincs.', 400);

  const state = ENGINES[game.type].addThrow(
    game.players.length,
    rulesOf(game),
    storedTurns(game),
    t,
    { enteredBy: req.user._id },
  );
  if (!state) throw new AppError('A játék már véget ért.', 400);
  await saveState(game, state);
  sendGame(res, game, req.user);
};

// DELETE /jatekok/darts/games/:id/throws/last - the last dart taken back.
// On a game the players ended themselves it takes that back instead: the
// game is on again, as it stood.
export const undoThrow = async (req, res) => {
  const game = await gameToEdit(req);
  if (game.ended) {
    game.ended = false;
    await saveState(game, replayGame(game));
  } else {
    await saveState(
      game,
      ENGINES[game.type].undoThrow(game.players.length, rulesOf(game), storedTurns(game)),
    );
  }
  sendGame(res, game, req.user);
};

// PATCH /jatekok/darts/games/:id/turns/:turnIdx - an earlier turn
// corrected; everything after it is worked out again. With ?preview=true
// nothing is stored: the answer is the game as it would be (the app asks
// before a correction that changes the placings).
export const editTurn = async (req, res) => {
  const game = await gameToEdit(req);
  const turnIdx = Number(req.params.turnIdx);
  const stored = game.turns[turnIdx];
  if (!Number.isInteger(turnIdx) || !stored) throw new AppError('Nincs ilyen kör.', 404);

  const throws = Array.isArray(req.body?.throws) ? req.body.throws.map(cleanThrow) : [];
  if (
    throws.length < 1 ||
    throws.length > x01.DARTS_PER_TURN ||
    !throws.every((t) => x01.isValidThrow(t))
  ) {
    throw new AppError('Egy kör 1-3 érvényes dobásból áll.', 400);
  }

  const turns = storedTurns(game);
  // Nothing changed: nothing to mark as corrected.
  const same = (a, b) => a.segment === b.segment && a.multiplier === b.multiplier;
  const before = turns[turnIdx].throws;
  if (before.length === throws.length && before.every((t, i) => same(t, throws[i]))) {
    return sendGame(res, game, req.user);
  }

  const state = ENGINES[game.type].editTurn(
    game.players.length,
    rulesOf(game),
    turns,
    turnIdx,
    throws,
    { editedBy: req.user._id, editedAt: new Date(), previousThrows: before },
  );
  // Fewer than three darts only if the turn ends there (a bust, a finish),
  // or it's the last one, still open.
  if (state.turns[turnIdx].short) {
    throw new AppError('Ehhez a körhöz három dobás kell.', 400);
  }
  if (req.query.preview === 'true') applyState(game, state);
  else await saveState(game, state);
  sendGame(res, game, req.user);
};

// POST /jatekok/darts/games/:id/finish - the players agree it's over
// ("Játék befejezése"): the game ends as it stands - whoever had finished
// keeps their place, the others are ranked by where they are.
export const finishGame = async (req, res) => {
  const game = await gameToEdit(req);
  if (game.status === 'finished') throw new AppError('A játék már véget ért.', 400);
  game.ended = true;
  await saveState(game, replayGame(game));
  sendGame(res, game, req.user);
};

// POST /jatekok/darts/games/:id/abandon - given up (started by mistake,
// say): it stays in the list but counts for nothing.
export const abandonGame = async (req, res) => {
  const game = await gameToEdit(req);
  if (game.status === 'finished') throw new AppError('A játék már véget ért.', 400);
  game.status = 'abandoned';
  await game.save();
  sendGame(res, game, req.user);
};
