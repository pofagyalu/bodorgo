import { describe, expect, it } from 'vitest';
import {
  addThrow,
  editTurn,
  isValidRounds,
  replay,
  undoThrow,
} from '../../src/jatekok/darts/highscore.js';

// Móka → Darts: the High Score rules (see jatekok/darts/highscore.js).

// "T20" / "D16" / "5" / "25" / "BULL" / "-" (a miss) → a dart.
const dart = (s) => {
  if (s === '-') return { segment: 0, multiplier: 0 };
  if (s === 'BULL') return { segment: 25, multiplier: 2 };
  const multiplier = { T: 3, D: 2 }[s[0]] ?? 1;
  return { segment: Number(multiplier === 1 ? s : s.slice(1)), multiplier };
};
const darts = (s) => s.split(/\s+/).map(dart);

// Plays the darts one by one, each by whoever is next.
const play = (playerCount, s, options = {}) =>
  darts(s).reduce((state, t) => addThrow(playerCount, options, state.turns, t), { turns: [] });

const TWO_ROUNDS = { rounds: 2 };

describe('darts High Score', () => {
  it('starts at nothing, the first player to throw', () => {
    const state = replay(2, TWO_ROUNDS, []);
    expect(state.players[0]).toMatchObject({ points: 0, darts: 0, position: null, average: null });
    expect(state.next).toEqual({ playerIdx: 0, round: 1, dartsLeft: 3 });
    expect(state.over).toBe(false);
  });

  it('adds up every dart - no bust, no way out', () => {
    const state = play(2, 'T20 T20 T20  BULL 25 -  D20', TWO_ROUNDS);
    expect(state.turns[0]).toMatchObject({ points: 180, startScore: 0, bust: false });
    expect(state.turns[1]).toMatchObject({ points: 75, finished: false });
    expect(state.turns[2]).toMatchObject({ points: 40, startScore: 180, round: 2 });
    expect(state.players.map((p) => p.points)).toEqual([220, 75]);
    expect(state.players.map((p) => p.average)).toEqual([165, 75]);
    expect(state.next).toEqual({ playerIdx: 0, round: 2, dartsLeft: 2 });
    // Nobody has a place before the end.
    expect(state.placings).toEqual([]);
  });

  it('is over once everyone has had the rounds - the most points wins', () => {
    const state = play(3, '1 1 1  20 20 20  5 5 5  1 1 1  - - -  T20 - -', TWO_ROUNDS);
    expect(state.over).toBe(true);
    expect(state.next).toBeNull();
    // 6, 60 and 75 points.
    expect(state.placings).toEqual([2, 1, 0]);
    expect(state.players.map((p) => p.position)).toEqual([3, 2, 1]);
    expect(state.players.every((p) => p.positionFinal)).toBe(true);
    expect(addThrow(3, TWO_ROUNDS, state.turns, dart('20'))).toBeNull();
  });

  it('among equals the better best turn is ahead, then the throwing order', () => {
    // Both 63: the first by 3 + 60, the second by 31 + 32.
    let state = play(2, '1 1 1  20 10 1  T20 - -  20 10 2', TWO_ROUNDS);
    expect(state.players.map((p) => p.points)).toEqual([63, 63]);
    expect(state.placings).toEqual([0, 1]);
    state = play(2, '20 10 1  1 1 1  20 10 2  T20 - -', TWO_ROUNDS);
    expect(state.placings).toEqual([1, 0]);
    // The same turns: whoever threw first.
    state = play(2, '20 - -  20 - -', { rounds: 1 });
    expect(state.placings).toEqual([0, 1]);
  });

  it('eight rounds unless told otherwise; a single player just plays them', () => {
    const alone = play(1, Array(8).fill('20 20 20').join('  '));
    expect(alone.over).toBe(true);
    expect(alone.players[0]).toMatchObject({ points: 480, position: 1, darts: 24 });
    expect(play(1, Array(7).fill('20 20 20').join('  ')).over).toBe(false);
  });

  it('ended by the players: ranked by the points as they stand', () => {
    const state = play(3, '1 1 1  20 20 20  5', TWO_ROUNDS);
    const ended = replay(3, { ...TWO_ROUNDS, ended: true }, state.turns);
    expect(ended).toMatchObject({ over: true, open: false, next: null, placings: [1, 2, 0] });
  });

  it('undo and a corrected turn replay the game', () => {
    const done = play(2, '20 20 20  1 1 1', { rounds: 1 });
    expect(done.over).toBe(true);
    // The last dart taken back: the game is on again.
    const back = undoThrow(2, { rounds: 1 }, done.turns);
    expect(back.over).toBe(false);
    expect(back.next).toEqual({ playerIdx: 1, round: 1, dartsLeft: 1 });
    // The second player's turn was three triple 20s: they win after all.
    const fixed = editTurn(2, { rounds: 1 }, done.turns, 1, darts('T20 T20 T20'));
    expect(fixed.placings).toEqual([1, 0]);
    // A corrected turn with too few darts is marked.
    const short = editTurn(2, { rounds: 1 }, done.turns, 0, darts('20'));
    expect(short.turns[0].short).toBe(true);
  });

  it('takes 1-30 whole rounds', () => {
    expect([1, 8, 30].every(isValidRounds)).toBe(true);
    expect([0, 31, 2.5, '8', null].some(isValidRounds)).toBe(false);
  });
});
