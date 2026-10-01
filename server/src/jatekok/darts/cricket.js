// Móka → Darts: the rules of Cricket, with standard scoring.
//
// Only 15-20 and the bull count. Each has to be hit three times to close
// it (a double counts as two hits, a triple as three; the bullseye as two).
// Hits on a number you've already closed score its value in points - as
// long as someone still playing hasn't closed it. Whoever has closed
// everything and has at least as many points as anyone still playing has
// finished: the first one wins, the others play on for the next places.
//
// As with X01 (x01.js), only the darts are stored and the game is replayed
// from them every time.

import { DARTS_PER_TURN } from './x01.js';
import { turnActions } from './turns.js';

// The numbers that count, in the order they're shown.
export const TARGETS = [20, 19, 18, 17, 16, 15, 25];
const MARKS_TO_CLOSE = 3;

// Replays a game from its stored turns - the same shape of answer as
// x01.js's replay, with marks instead of a score to count down:
// - a player's `marks` (hits on each number, at most three), `points`, and
//   `average`: the marks per round (three darts) - only hits that closed
//   or scored count;
// - a turn's `marks` and `points`; it ends after three darts or a finish;
// - a place is final the moment it's taken (finishing order);
// - it's over once at most one player is still in, or when the players end
//   it (options.ended) - those still in are then ranked by points, then by
//   marks.
export function replay(playerCount, options, storedTurns) {
  const { ended = false } = options ?? {};
  const players = Array.from({ length: playerCount }, () => ({
    marks: Object.fromEntries(TARGETS.map((n) => [n, 0])),
    points: 0,
    darts: 0,
    marksTotal: 0,
    turns: 0,
    finished: false,
    position: null,
    positionFinal: false,
  }));
  const finishOrder = [];
  const stillIn = () => players.filter((p) => !p.finished);
  const hasClosedAll = (p) => TARGETS.every((n) => p.marks[n] >= MARKS_TO_CLOSE);
  // Everything closed, and nobody still playing has more points.
  const canFinish = (p) =>
    hasClosedAll(p) &&
    stillIn()
      .filter((other) => other !== p)
      .every((other) => p.points >= other.points);
  const finish = (p) => {
    p.finished = true;
    finishOrder.push(players.indexOf(p));
  };
  const isOver = () => (playerCount === 1 ? players[0].finished : stillIn().length <= 1);
  const turnIsDone = (turn) => turn.finished || turn.throws.length >= DARTS_PER_TURN;

  const turns = [];
  let over = false;
  let open = false;

  storedTurns.forEach((stored, i) => {
    const player = players[stored.playerIdx];
    if (over || !player || player.finished) return;

    const turn = {
      ...stored,
      round: player.turns + 1,
      startScore: player.points,
      throws: [],
      points: 0,
      marks: 0,
      bust: false,
      finished: false,
      short: false,
    };
    for (const t of stored.throws) {
      if (turnIsDone(turn)) break;
      turn.throws.push({ segment: t.segment, multiplier: t.multiplier });
      player.darts += 1;
      if (TARGETS.includes(t.segment)) {
        const closing = Math.min(t.multiplier, MARKS_TO_CLOSE - player.marks[t.segment]);
        player.marks[t.segment] += closing;
        // The hits beyond closing score, while someone still in has it open.
        const scoring = stillIn().some((other) => other.marks[t.segment] < MARKS_TO_CLOSE)
          ? t.multiplier - closing
          : 0;
        turn.points += scoring * t.segment;
        player.points += scoring * t.segment;
        turn.marks += closing + scoring;
        player.marksTotal += closing + scoring;
      }
      turn.finished = canFinish(player);
    }
    if (turn.throws.length === 0) return;
    turns.push(turn);

    if (!turnIsDone(turn) && i === storedTurns.length - 1) {
      open = true;
      return;
    }
    turn.short = !turnIsDone(turn);
    player.turns += 1;
    if (turn.finished) {
      finish(player);
      // With them out of the way, someone who had closed everything but
      // was behind on points may have finished too - the most points first.
      for (;;) {
        const nextOut = stillIn()
          .filter(canFinish)
          .sort((a, b) => b.points - a.points)[0];
        if (!nextOut || stillIn().length <= 1) break;
        finish(nextOut);
      }
    }
    over = isOver();
  });

  if (ended) {
    over = true;
    open = false;
  }

  const rest = over
    ? players
        .map((p, idx) => ({ p, idx }))
        .filter(({ p }) => !p.finished)
        .sort((a, b) => b.p.points - a.p.points || b.p.marksTotal - a.p.marksTotal || a.idx - b.idx)
        .map(({ idx }) => idx)
    : [];
  const placings = [...finishOrder, ...rest];
  placings.forEach((idx, place) => {
    players[idx].position = place + 1;
    players[idx].positionFinal = true;
  });

  players.forEach((p) => {
    p.average = p.darts ? Math.round((p.marksTotal / p.darts) * 3 * 100) / 100 : null;
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
          !p.finished && (best === -1 || p.turns < players[best].turns) ? idx : best,
        -1,
      );
      next = { playerIdx, round: players[playerIdx].turns + 1, dartsLeft: DARTS_PER_TURN };
    }
  }

  return { players, turns, open, next, placings, over };
}

// Throwing a dart, taking one back, correcting a turn (see turns.js).
export const { addThrow, undoThrow, editTurn } = turnActions(replay);
