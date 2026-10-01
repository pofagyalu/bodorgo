import { describe, expect, it } from 'vitest';
import { addThrow, editTurn, replay, undoThrow } from '../../src/jatekok/darts/cricket.js';
import { replay as replayX01 } from '../../src/jatekok/darts/x01.js';

// Móka → Darts: the Cricket rules (see jatekok/darts/cricket.js).

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

// Everything closed in eight darts (the bull takes a bullseye and a 25).
const CLOSE_ALL = 'T20 T19 T18  T17 T16 T15  BULL 25';

describe('darts Cricket', () => {
  it('starts with nothing closed', () => {
    const state = replay(2, {}, []);
    expect(state.players[0].marks).toEqual({ 20: 0, 19: 0, 18: 0, 17: 0, 16: 0, 15: 0, 25: 0 });
    expect(state.next).toEqual({ playerIdx: 0, round: 1, dartsLeft: 3 });
  });

  it('counts hits on 15-20 and the bull only, a double as two, a triple as three', () => {
    const state = play(2, '20 D19 T18  5 T14 25');
    expect(state.players[0].marks).toMatchObject({ 20: 1, 19: 2, 18: 3 });
    expect(state.turns[0]).toMatchObject({ marks: 6, points: 0 });
    expect(state.players[1].marks).toMatchObject({ 25: 1, 20: 0 });
    expect(state.turns[1].marks).toBe(1);
    // Marks per round: 6 in three darts, 1 in three darts.
    expect(state.players.map((p) => p.average)).toEqual([6, 1]);
  });

  it('scores on a closed number while an opponent has it open', () => {
    // T20 closes it; the next T20 is 60 points; D20 another 40.
    let state = play(2, 'T20 T20 D20');
    expect(state.players[0]).toMatchObject({ points: 100, marksTotal: 8 });
    expect(state.turns[0]).toMatchObject({ points: 100, marks: 8 });

    // A dart that closes and overflows: two marks to close, one scores.
    state = play(2, '20 T20 -');
    expect(state.players[0].marks[20]).toBe(3);
    expect(state.players[0].points).toBe(20);

    // The bull: 25 a hit, the bullseye two.
    state = play(2, 'BULL BULL 25');
    expect(state.players[0]).toMatchObject({ points: 50, marksTotal: 5 });
  });

  it('scores nothing once everyone has closed the number', () => {
    const state = play(2, 'T20 - -  T20 - -  T20 - -');
    expect(state.players[0].points).toBe(0);
    expect(state.turns[2]).toMatchObject({ marks: 0, points: 0 });
  });

  it('whoever closes everything with the most points has finished - the others play on', () => {
    // Three players; the first closes everything in round 3.
    const state = play(3, `T20 T19 T18  - - -  - - -  T17 T16 T15  - - -  - - -  BULL 25`);
    expect(state.turns.at(-1)).toMatchObject({ finished: true });
    expect(state.turns.at(-1).throws).toHaveLength(2);
    expect(state.players[0]).toMatchObject({ position: 1, positionFinal: true });
    expect(state.over).toBe(false);
    expect(state.next).toEqual({ playerIdx: 1, round: 3, dartsLeft: 3 });
  });

  it('closing everything is not enough while behind on points', () => {
    // Player 2 scores 60 on 20s first; player 1 then closes everything -
    // and still has the turn's third dart, and no place.
    const state = play(2, '- - -  T20 T20 -  T20 T19 T18  - - -  T17 T16 T15  - - -  BULL 25');
    expect(Object.values(state.players[0].marks).every((m) => m === 3)).toBe(true);
    expect(state.players[0]).toMatchObject({ points: 0, position: null });
    expect(state.players[1].points).toBe(60);
    expect(state.next).toEqual({ playerIdx: 0, round: 4, dartsLeft: 1 });
    expect(state.over).toBe(false);
  });

  it('the last one in is last; a single player just closes everything', () => {
    const two = play(2, `T20 T19 T18  - - -  T17 T16 T15  - - -  BULL 25`);
    expect(two.over).toBe(true);
    expect(two.placings).toEqual([0, 1]);
    expect(two.next).toBeNull();
    expect(addThrow(2, {}, two.turns, dart('20'))).toBeNull();

    const alone = play(1, CLOSE_ALL);
    expect(alone.over).toBe(true);
    expect(alone.players[0].position).toBe(1);
  });

  it('ended by the players: ranked by points, then by marks', () => {
    // 1: 60 points; 2: no points, 3 marks; 3: no points, 6 marks.
    const state = play(3, 'T20 T20 -  T19 - -  T18 T17 -');
    const ended = replay(3, { ended: true }, state.turns);
    expect(ended.over).toBe(true);
    expect(ended.placings).toEqual([0, 2, 1]);
    expect(ended.next).toBeNull();
  });

  it('undo and a corrected turn replay the game', () => {
    let state = play(2, 'T20 T20 D20  T20');
    state = undoThrow(2, {}, state.turns);
    expect(state.turns).toHaveLength(1);
    // The first turn was T20 and two misses: no points after all.
    state = editTurn(2, {}, play(2, 'T20 T20 D20  T20 - -').turns, 0, darts('T20 - -'));
    expect(state.players[0].points).toBe(0);
    expect(state.players[1].marks[20]).toBe(3);
  });
});

describe('darts X01: ended by the players', () => {
  it('is over as it stands - finishers keep their place, the rest by what is left', () => {
    const X101 = { startScore: 101 };
    // Zoli checks out; Anna has 41 left, Peti 98.
    const turns = [
      { playerIdx: 0, throws: darts('T20 20 T7') },
      { playerIdx: 1, throws: darts('T20 - -') },
      { playerIdx: 2, throws: darts('1 1 1') },
      { playerIdx: 1, throws: darts('1') },
    ];
    expect(replayX01(3, X101, turns).over).toBe(false);
    const ended = replayX01(3, { ...X101, ended: true }, turns);
    expect(ended).toMatchObject({ over: true, open: false, next: null, placings: [0, 1, 2] });
    expect(ended.players.map((p) => p.position)).toEqual([1, 2, 3]);
  });
});
