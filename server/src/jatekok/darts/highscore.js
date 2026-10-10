// Móka → Darts: the rules of High Score (also known as Count Up) - the
// simplest game there is. Everyone starts at nothing and adds up what they
// throw; after a set number of rounds whoever has the most points wins.
// No busts, no way out: every dart counts.
//
// As with X01 (x01.js), only the darts are stored and the game is replayed
// from them every time.

import { DARTS_PER_TURN, throwPoints } from './x01.js';
import { turnActions } from './turns.js';

export const DEFAULT_ROUNDS = 8;
export const MAX_ROUNDS = 30;

export const isValidRounds = (rounds) =>
  Number.isInteger(rounds) && rounds >= 1 && rounds <= MAX_ROUNDS;

const turnIsDone = (turn) => turn.throws.length >= DARTS_PER_TURN;

// Replays a game from its stored turns - the same shape of answer as
// x01.js's replay, counting up instead of down:
// - a player's `points`, and `average`: the points per three darts;
// - a turn always takes three darts - nothing ends it sooner;
// - whoever has had the fewest turns throws next (the earlier in the order
//   first), until everyone has had `options.rounds` of them: then it's over;
// - nobody has a place before the end. Then: the most points, among equals
//   the better best turn, then the order;
// - the players can also end it any time (options.ended): it's over as it
//   stands, ranked the same way.
export function replay(playerCount, options, storedTurns) {
  const { rounds = DEFAULT_ROUNDS, ended = false } = options ?? {};
  const players = Array.from({ length: playerCount }, () => ({
    points: 0,
    darts: 0,
    turns: 0,
    bestTurn: 0,
    position: null,
    positionFinal: false,
  }));
  const isDone = (p) => p.turns >= rounds;

  const turns = [];
  let over = false;
  let open = false;

  storedTurns.forEach((stored, i) => {
    const player = players[stored.playerIdx];
    if (over || !player || isDone(player)) return;

    const turn = {
      ...stored,
      round: player.turns + 1,
      startScore: player.points,
      throws: [],
      points: 0,
      bust: false,
      finished: false,
      short: false,
    };
    for (const t of stored.throws) {
      if (turnIsDone(turn)) break;
      turn.throws.push({ segment: t.segment, multiplier: t.multiplier });
      turn.points += throwPoints(t);
    }
    if (turn.throws.length === 0) return;

    player.darts += turn.throws.length;
    player.points += turn.points;
    player.bestTurn = Math.max(player.bestTurn, turn.points);
    turns.push(turn);

    if (!turnIsDone(turn) && i === storedTurns.length - 1) {
      open = true;
      return;
    }
    turn.short = !turnIsDone(turn);
    player.turns += 1;
    over = players.every(isDone);
  });

  if (ended) {
    over = true;
    open = false;
  }

  const placings = over
    ? players
        .map((p, idx) => ({ p, idx }))
        .sort((a, b) => b.p.points - a.p.points || b.p.bestTurn - a.p.bestTurn || a.idx - b.idx)
        .map(({ idx }) => idx)
    : [];
  placings.forEach((idx, place) => {
    players[idx].position = place + 1;
    players[idx].positionFinal = true;
  });

  players.forEach((p) => {
    p.average = p.darts ? Math.round((p.points / p.darts) * 3 * 100) / 100 : null;
  });

  let next = null;
  if (!over) {
    if (open) {
      const turn = turns.at(-1);
      next = {
        playerIdx: turn.playerIdx,
        round: turn.round,
        dartsLeft: DARTS_PER_TURN - turn.throws.length,
      };
    } else {
      const playerIdx = players.reduce(
        (best, p, idx) =>
          !isDone(p) && (best === -1 || p.turns < players[best].turns) ? idx : best,
        -1,
      );
      next = { playerIdx, round: players[playerIdx].turns + 1, dartsLeft: DARTS_PER_TURN };
    }
  }

  return { players, turns, open, next, placings, over };
}

// Throwing a dart, taking one back, correcting a turn (see turns.js).
export const { addThrow, undoThrow, editTurn } = turnActions(replay);
