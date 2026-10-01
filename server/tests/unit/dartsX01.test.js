import { describe, expect, it } from 'vitest';
import {
  addThrow,
  checkoutHint,
  editTurn,
  isValidThrow,
  replay,
  undoThrow,
} from '../../src/jatekok/darts/x01.js';

// Móka → Darts: the X01 rules (see jatekok/darts/x01.js).

// "T20" / "D16" / "5" / "25" / "BULL" / "-" (a miss) → a dart.
const dart = (s) => {
  if (s === '-') return { segment: 0, multiplier: 0 };
  if (s === 'BULL') return { segment: 25, multiplier: 2 };
  const multiplier = { T: 3, D: 2 }[s[0]] ?? 1;
  return { segment: Number(multiplier === 1 ? s : s.slice(1)), multiplier };
};
const darts = (s) => s.split(/\s+/).map(dart);
const label = (t) => (t.segment === 0 ? '-' : `${['', '', 'D', 'T'][t.multiplier]}${t.segment}`);

// Plays the darts one by one, each by whoever is next.
const play = (playerCount, options, s) =>
  darts(s).reduce((state, t) => addThrow(playerCount, options, state.turns, t), {
    turns: [],
  });

const X101 = { startScore: 101, outMode: 'single', playUntil: 'all' };

describe('darts X01', () => {
  it('knows a real dart from an impossible one', () => {
    expect(darts('T20 D1 20 25 BULL -').every(isValidThrow)).toBe(true);
    expect(isValidThrow({ segment: 25, multiplier: 3 })).toBe(false);
    expect(isValidThrow({ segment: 21, multiplier: 1 })).toBe(false);
    expect(isValidThrow({ segment: 0, multiplier: 1 })).toBe(false);
    expect(isValidThrow({ segment: 20, multiplier: 0 })).toBe(false);
    expect(isValidThrow(null)).toBe(false);
  });

  it('starts with the first player, on the default 301', () => {
    const state = replay(3, {}, []);
    expect(state.players.map((p) => p.remaining)).toEqual([301, 301, 301]);
    expect(state.next).toEqual({ playerIdx: 0, round: 1, dartsLeft: 3 });
    expect(state.over).toBe(false);
  });

  it('counts down and passes the turn after three darts', () => {
    let state = play(2, X101, 'T20 5');
    expect(state.players[0].remaining).toBe(36);
    expect(state.open).toBe(true);
    expect(state.next).toEqual({ playerIdx: 0, round: 1, dartsLeft: 1 });

    state = addThrow(2, X101, state.turns, dart('-'));
    expect(state.turns[0]).toMatchObject({ playerIdx: 0, round: 1, points: 65, bust: false });
    expect(state.next).toEqual({ playerIdx: 1, round: 1, dartsLeft: 3 });
    expect(state.players[0].average).toBe(65);
  });

  it('a bust ends the turn and scores nothing', () => {
    // 101: 60 + 20 leaves 21, then T20 is too much.
    const state = play(2, X101, 'T20 20 T20');
    expect(state.turns[0]).toMatchObject({ bust: true, points: 0 });
    expect(state.players[0]).toMatchObject({ remaining: 101, darts: 3, points: 0 });
    expect(state.next.playerIdx).toBe(1);
  });

  it('single-out finishes on anything, double-out only on a double', () => {
    const single = play(1, X101, 'T20 20 T7');
    expect(single.turns[0].finished).toBe(true);
    expect(single.over).toBe(true);

    const double = { ...X101, outMode: 'double' };
    expect(play(1, double, 'T20 20 T7').turns[0]).toMatchObject({ bust: true, finished: false });
    // Landing on 1 is a bust too.
    expect(play(1, double, 'T20 20 20').turns[0].bust).toBe(true);
    // 101: T20, 9, D16 - and the bullseye counts as a double.
    expect(play(1, double, 'T20 9 D16').over).toBe(true);
    expect(play(1, double, 'T17 BULL').over).toBe(true);
  });

  it('a finish ends the turn early', () => {
    const state = play(2, X101, 'T20 20 - 1 1 1 T7');
    expect(state.turns.at(-1)).toMatchObject({ playerIdx: 0, finished: true });
    expect(state.turns.at(-1).throws).toHaveLength(1);
    expect(state.players[0]).toMatchObject({ remaining: 0, finishedRound: 2, finishDarts: 1 });
  });

  it('plays on after the winner, skipping whoever has finished', () => {
    // Three players; the first finishes in round 2.
    let state = play(3, X101, 'T20 20 1  1 1 1  1 1 1  20');
    expect(state.players[0]).toMatchObject({ position: 1, positionFinal: false });
    expect(state.over).toBe(false);
    expect(state.next.playerIdx).toBe(1);
    // The other two have their round 2, then only they play round 3.
    state = play(3, X101, 'T20 20 1  1 1 1  1 1 1  20  1 1 1  1 1 1');
    expect(state.players[0].positionFinal).toBe(true);
    expect(state.next).toEqual({ playerIdx: 1, round: 3, dartsLeft: 3 });
  });

  it('ranks finishers of the same round by darts, and the last one in by default', () => {
    // Round 1 leaves 21, 20 and 101; in round 2 the first finishes with two
    // darts, the second with one - and takes the 1st place from them.
    const state = play(3, X101, 'T20 20 -  T20 20 1  - - -  1 20  20');
    expect(state.over).toBe(false);
    expect(state.players[0].position).toBe(2);
    expect(state.players[1].position).toBe(1);
    // The third still has their round; then it's over, they're 3rd.
    const end = play(3, X101, 'T20 20 -  T20 20 1  - - -  1 20  20  1 1 1');
    expect(end.over).toBe(true);
    expect(end.next).toBe(null);
    expect(end.placings).toEqual([1, 0, 2]);
    expect(end.players.every((p) => p.positionFinal)).toBe(true);
  });

  it('stops at the winner or the podium if asked to, ranking the rest by what is left', () => {
    const winner = { ...X101, playUntil: 'winner' };
    // The first finishes in round 2; the round is still played out.
    let state = play(3, winner, 'T20 20 1  T20 1 1  1 1 1  20');
    expect(state.over).toBe(false);
    state = play(3, winner, 'T20 20 1  T20 1 1  1 1 1  20  1 1 1  1 1 1');
    expect(state.over).toBe(true);
    expect(state.placings).toEqual([0, 1, 2]);
    expect(state.players.map((p) => p.remaining)).toEqual([0, 36, 95]);

    // Five players, top 3: over once three have finished.
    const top3 = { startScore: 101, playUntil: 'top3' };
    const round1 = 'T20 20 1  T20 20 1  T20 20 1  T20 1 1  1 1 1';
    state = play(5, top3, `${round1}  20  20  20  1 1 1  1 1 1`);
    expect(state.over).toBe(true);
    expect(state.placings).toEqual([0, 1, 2, 3, 4]);
  });

  it('undo takes back a dart, a bust, a finish - across turns', () => {
    let state = play(2, X101, 'T20 20 T20');
    expect(state.next.playerIdx).toBe(1);
    state = undoThrow(2, X101, state.turns);
    expect(state.turns[0]).toMatchObject({ bust: false, points: 80 });
    expect(state.next).toEqual({ playerIdx: 0, round: 1, dartsLeft: 1 });

    // A single dart's turn goes with its dart.
    state = undoThrow(2, X101, play(2, X101, 'T20 20 1 5').turns);
    expect(state.turns).toHaveLength(1);
    expect(state.next).toEqual({ playerIdx: 1, round: 1, dartsLeft: 3 });

    // The finishing dart of a finished game.
    const done = play(1, X101, 'T20 20 T7');
    state = undoThrow(1, X101, done.turns);
    expect(state.over).toBe(false);
    expect(state.players[0]).toMatchObject({ remaining: 21, position: null });

    expect(undoThrow(2, X101, []).turns).toEqual([]);
  });

  it('no more darts once the game is over', () => {
    const done = play(1, X101, 'T20 20 T7');
    expect(addThrow(1, X101, done.turns, dart('1'))).toBe(null);
  });

  it('a corrected turn replays everything after it', () => {
    // Player 1 seemed to bust in round 2 (21 left, T20) - it was a 20.
    const state = play(2, X101, 'T20 20 -  1 1 1  T20  1 1 1');
    expect(state.turns[2].bust).toBe(true);
    const fixed = editTurn(2, X101, state.turns, 2, darts('20 - -'), { editedBy: 'me' });
    expect(fixed.turns[2]).toMatchObject({ bust: false, points: 20, editedBy: 'me', short: false });
    expect(fixed.players[0].remaining).toBe(1);

    // The same turn corrected to a finish: it now ends on its first dart.
    const won = editTurn(2, X101, state.turns, 2, darts('T7 1 1'));
    expect(won.turns[2].throws).toHaveLength(1);
    expect(won.players[0].position).toBe(1);
  });

  it('a correction can take a finish back, or leave later turns out', () => {
    // Player 1 finished in round 2, player 2 played on alone.
    const state = play(2, { ...X101, playUntil: 'winner' }, 'T20 20 1  1 1 1  20  1 1 1');
    expect(state.over).toBe(true);
    // It wasn't a 20 but a 10: the game is on again, they have a dart left.
    const back = editTurn(2, X101, state.turns, 2, darts('10'));
    expect(back.over).toBe(false);
    expect(back.turns[2].short).toBe(true);
    expect(back.players[0].remaining).toBe(10);

    // Round 1 corrected into a finish for player 1 (impossible, but typed):
    // their later turn is left out.
    const early = editTurn(2, X101, state.turns, 0, darts('T20 20 T7'));
    expect(early.turns.filter((t) => t.playerIdx === 0)).toHaveLength(1);
    expect(early.players[0].finishedRound).toBe(1);
  });

  it('suggests the shortest way out', () => {
    const hint = (...args) => checkoutHint(...args)?.map(label);
    expect(hint(20)).toEqual(['20']);
    expect(hint(40)).toEqual(['D20']);
    expect(hint(60)).toEqual(['T20']);
    expect(hint(50)).toEqual(['D25']);
    expect(hint(61)).toEqual(['T20', '1']);
    expect(hint(100)).toEqual(['T20', 'D20']);
    expect(hint(180)).toEqual(['T20', 'T20', 'T20']);
    expect(hint(181)).toBeUndefined();
    // Only with the darts left in the turn.
    expect(hint(100, 'single', 1)).toBeUndefined();

    expect(hint(40, 'double')).toEqual(['D20']);
    expect(hint(20, 'double')).toEqual(['D10']);
    expect(hint(170, 'double')).toEqual(['T20', 'T20', 'D25']);
    expect(hint(1, 'double')).toBeUndefined();
    expect(hint(169, 'double')).toBeUndefined();
    expect(hint(0)).toBeUndefined();
  });
});
