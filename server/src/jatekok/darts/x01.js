// Móka → Darts: the rules of X01 (301 / 201 / 101), for friends at a real
// board with one phone keeping score.
//
// The darts thrown are the only thing stored (a game's `turns`, each with
// its `throws`); everything else - what's left, busts, who's next, the
// placings, the averages - is worked out here by replaying them (replay).
// That's what makes undo and correcting an earlier turn simple: change the
// darts, replay.
//
// A dart: { segment, multiplier } - segment 1-20 with multiplier 1-3,
// 25 with 1 (outer bull) or 2 (bullseye, 50), or 0 with 0: a miss (also a
// bounce-out, or a dart off the board).

import { turnActions } from './turns.js';

export const START_SCORES = [301, 201, 101];
export const OUT_MODES = ['single', 'double'];
// Where a game stops: at its winner, once the podium is full, or when
// everyone has a place.
export const PLAY_UNTIL = ['winner', 'top3', 'all'];
export const DARTS_PER_TURN = 3;

export const isValidThrow = (t) => {
  if (!t || !Number.isInteger(t.segment) || !Number.isInteger(t.multiplier)) return false;
  if (t.segment === 0) return t.multiplier === 0;
  if (t.segment === 25) return t.multiplier === 1 || t.multiplier === 2;
  return t.segment >= 1 && t.segment <= 20 && t.multiplier >= 1 && t.multiplier <= 3;
};

export const throwPoints = (t) => t.segment * t.multiplier;

// How many places the game decides by finishing (the rest are ranked by
// what they have left).
const placesToDecide = (playerCount, playUntil) => {
  if (playUntil === 'winner') return 1;
  if (playUntil === 'top3') return Math.min(3, playerCount);
  return playerCount;
};

const turnIsDone = (turn) => turn.bust || turn.finished || turn.throws.length >= DARTS_PER_TURN;

// Replays a game from its stored turns ({ playerIdx, throws }, in the order
// they were thrown; anything else on a turn is kept as it is).
//
// - A turn ends after three darts, a bust or a finish; darts stored past
//   that are dropped (a corrected turn can end sooner than it did).
// - Bust: the score would go below 0 - with double-out also if it lands on
//   1, or reaches 0 without a double. The turn scores nothing.
// - Whoever has had the fewest turns throws next (the earlier in the order
//   first), finished players left out - the plain rotation, which also
//   lets someone catch up if a correction takes their finish back.
// - Play goes on after the first finish. Players finishing in the same
//   round are ranked by the darts their last turn took (then by the
//   order), so a place only becomes final (`positionFinal`) once everyone
//   has had that round.
// - The game is over at the end of a round, once enough have finished
//   (options.playUntil) or at most one player is still in. Those still in
//   are then ranked by what they have left.
// - The players can also agree to end it any time (options.ended, the
//   "Játék befejezése" button): it's over as it stands, those still in
//   ranked the same way.
// - A turn that isn't done but has turns after it (only a correction can
//   cause that) is marked `short`; the last one not done is the open turn.
//   Turns of a player who has already finished, or after the game's end,
//   are left out.
export function replay(playerCount, options, storedTurns) {
  const { startScore = 301, outMode = 'single', playUntil = 'all', ended = false } = options ?? {};
  const players = Array.from({ length: playerCount }, () => ({
    remaining: startScore,
    darts: 0,
    points: 0,
    turns: 0,
    finishedRound: null,
    finishDarts: null,
    position: null,
    positionFinal: false,
  }));
  const target = placesToDecide(playerCount, playUntil);
  const stillIn = () => players.filter((p) => p.finishedRound === null);

  const isOver = () => {
    const unfinished = stillIn();
    const finished = playerCount - unfinished.length;
    if (finished === 0) return false;
    const lastRound = Math.max(...players.map((p) => p.turns));
    if (unfinished.some((p) => p.turns < lastRound)) return false;
    return finished >= target || unfinished.length <= 1;
  };

  const turns = [];
  let over = false;
  let open = false;

  storedTurns.forEach((stored, i) => {
    const player = players[stored.playerIdx];
    if (over || !player || player.finishedRound !== null) return;

    const turn = {
      ...stored,
      round: player.turns + 1,
      startScore: player.remaining,
      throws: [],
      points: 0,
      bust: false,
      finished: false,
      short: false,
    };
    for (const t of stored.throws) {
      if (turnIsDone(turn)) break;
      turn.throws.push({ segment: t.segment, multiplier: t.multiplier });
      const left = turn.startScore - turn.points - throwPoints(t);
      const needsDouble = outMode === 'double';
      if (left < 0 || (needsDouble && (left === 1 || (left === 0 && t.multiplier !== 2)))) {
        turn.bust = true;
        turn.points = 0;
      } else {
        turn.points += throwPoints(t);
        turn.finished = left === 0;
      }
    }
    if (turn.throws.length === 0) return;

    player.darts += turn.throws.length;
    player.points += turn.points;
    player.remaining = turn.startScore - turn.points;
    turns.push(turn);

    if (!turnIsDone(turn) && i === storedTurns.length - 1) {
      open = true;
      return;
    }
    turn.short = !turnIsDone(turn);
    player.turns += 1;
    if (turn.finished) {
      player.finishedRound = turn.round;
      player.finishDarts = turn.throws.length;
    }
    over = isOver();
  });

  if (ended) {
    over = true;
    open = false;
  }

  // The placings: those who finished, then (once it's over) the rest.
  const byOrder = players.map((p, idx) => ({ p, idx }));
  const finishers = byOrder
    .filter(({ p }) => p.finishedRound !== null)
    .sort(
      (a, b) =>
        a.p.finishedRound - b.p.finishedRound || a.p.finishDarts - b.p.finishDarts || a.idx - b.idx,
    );
  const rest = over
    ? byOrder
        .filter(({ p }) => p.finishedRound === null)
        .sort((a, b) => a.p.remaining - b.p.remaining || a.idx - b.idx)
    : [];
  const placings = [...finishers, ...rest].map(({ idx }) => idx);
  placings.forEach((idx, place) => {
    const p = players[idx];
    p.position = place + 1;
    p.positionFinal = over || stillIn().every((other) => other.turns >= p.finishedRound);
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
          p.finishedRound === null && (best === -1 || p.turns < players[best].turns) ? idx : best,
        -1,
      );
      next = { playerIdx, round: players[playerIdx].turns + 1, dartsLeft: DARTS_PER_TURN };
    }
  }

  return { players, turns, open, next, placings, over };
}

// Throwing a dart, taking one back, correcting a turn (see turns.js).
export const { addThrow, undoThrow, editTurn } = turnActions(replay);

// --- Checkout hint ---

// Every dart that scores - singles first, then triples, then doubles: among
// darts worth the same, the first one here is the one suggested.
const SEGMENTS = [...Array.from({ length: 20 }, (_, i) => 20 - i), 25];
const SCORING_THROWS = [1, 3, 2].flatMap((multiplier) =>
  SEGMENTS.filter((segment) => segment !== 25 || multiplier !== 3).map((segment) => ({
    segment,
    multiplier,
  })),
);

// The dart to finish on for what's left: any double with double-out;
// otherwise the easiest - a single, then a double, then a triple.
const finisher = (left, outMode) =>
  [1, 2, 3]
    .filter((multiplier) => outMode !== 'double' || multiplier === 2)
    .map((multiplier) =>
      SCORING_THROWS.find((t) => t.multiplier === multiplier && throwPoints(t) === left),
    )
    .find(Boolean) ?? null;

// The way to finish `remaining` with the fewest darts (at most `maxDarts`),
// as the darts to throw - or null if there's none. Among the ways with as
// many darts: the easier last dart, then the bigger darts first.
export function checkoutHint(remaining, outMode = 'single', maxDarts = DARTS_PER_TURN) {
  if (!(remaining > 0)) return null;
  const rank = (route) => [
    route.at(-1).multiplier,
    ...route.slice(0, -1).map((t) => -throwPoints(t)),
  ];
  const better = (a, b) => {
    if (!b) return true;
    const [ra, rb] = [rank(a), rank(b)];
    const i = ra.findIndex((v, k) => v !== rb[k]);
    return i !== -1 && ra[i] < rb[i];
  };

  const routes = (left, darts) => {
    const last = finisher(left, outMode);
    if (darts === 1) return last ? [[last]] : [];
    return SCORING_THROWS.filter((t) => throwPoints(t) < left).flatMap((t) =>
      routes(left - throwPoints(t), darts - 1).map((route) => [t, ...route]),
    );
  };

  for (let darts = 1; darts <= Math.min(maxDarts, DARTS_PER_TURN); darts += 1) {
    let best = null;
    for (const route of routes(remaining, darts)) if (better(route, best)) best = route;
    if (best) return best;
  }
  return null;
}
