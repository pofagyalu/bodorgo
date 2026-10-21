import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORING,
  cleanQuiz,
  cleanScoring,
  mapPoints,
  pointsFor,
  standings,
  withBonuses,
} from '../../src/jatekok/quiz/scoring.js';

// Móka → Kvíz: the rules (over HTTP: tests/api/quiz.test.js).

const question = (over = {}) => ({
  text: 'Hol volt az első tábor?',
  answers: ['Mátra', 'Bükk', 'Zemplén'],
  correct: 1,
  ...over,
});

describe('pointsFor', () => {
  it('is worth the most at once, half at the last moment', () => {
    expect(pointsFor(0, 20000)).toBe(1000);
    expect(pointsFor(10000, 20000)).toBe(750);
    expect(pointsFor(20000, 20000)).toBe(500);
  });

  it('never goes outside that, whatever the clock says', () => {
    expect(pointsFor(-50, 20000)).toBe(1000);
    expect(pointsFor(20400, 20000)).toBe(500);
  });

  it('falls to what the scoring sets for the last moment', () => {
    expect(pointsFor(0, 20000, 200)).toBe(1000);
    expect(pointsFor(10000, 20000, 200)).toBe(600);
    expect(pointsFor(20000, 20000, 200)).toBe(200);
    // Speed switched off.
    expect(pointsFor(15000, 20000, 1000)).toBe(1000);
  });
});

describe('mapPoints', () => {
  const bounds = { south: 45.5, west: 15.8, north: 48.8, east: 23.2 };
  const place = { lat: 47.5, lng: 19 };
  // About 150 km east of it; the map's diagonal is about 670 km.
  const guess = { lat: 47.5, lng: 21 };

  it('is worth nothing from the set part of the map’s diagonal away', () => {
    expect(mapPoints(place, place, bounds)).toBe(1000);
    const half = mapPoints(place, guess, bounds);
    expect(half).toBeGreaterThan(500);
    expect(mapPoints(place, guess, bounds, 50)).toBe(half);
    expect(mapPoints(place, guess, bounds, 100)).toBeGreaterThan(half);
    expect(mapPoints(place, guess, bounds, 10)).toBe(0);
  });
});

describe('cleanScoring', () => {
  const scoring = (over = {}) => ({ ...DEFAULT_SCORING, ...over });

  it('takes whole numbers within their limits', () => {
    const sent = scoring({ minPoints: 300, orderBonus: [300, 200, 100], streakBonus: 100 });
    expect(cleanScoring({ ...sent, maxPoints: 5000 })).toEqual({ scoring: sent });
  });

  it('says what is wrong', () => {
    const bad = [
      [undefined, 'utolsó pillanat'],
      [scoring({ minPoints: 0 }), 'utolsó pillanat'],
      [scoring({ minPoints: 99 }), 'utolsó pillanat'],
      [scoring({ minPoints: 1001 }), 'utolsó pillanat'],
      [scoring({ minPoints: 499.5 }), 'utolsó pillanat'],
      [scoring({ orderBonus: [100, 50] }), 'leggyorsabbak'],
      [scoring({ orderBonus: [100, -1, 0] }), 'leggyorsabbak'],
      [scoring({ orderBonus: '300' }), 'leggyorsabbak'],
      [scoring({ orderBonus: [100, 200, 0] }), 'lassabb'],
      [scoring({ orderBonus: [300, 100, 200] }), 'lassabb'],
      [scoring({ mapReachPct: 9 }), 'térképes'],
      [scoring({ mapReachPct: 101 }), 'térképes'],
      [scoring({ streakBonus: '100' }), 'sorozatbónusz'],
    ];
    for (const [body, part] of bad) {
      expect(cleanScoring(body).error, JSON.stringify(body)).toContain(part);
    }
  });
});

describe('withBonuses', () => {
  const questions = [{ type: 'choice' }, { type: 'map' }, { type: 'choice' }, { type: 'choice' }];
  const row = (user, questionIdx, points, ms) => ({ user, questionIdx, points, ms });
  const worth = (rows) => rows.map((r) => `${r.user}${r.questionIdx}:${r.points}+${r.bonus}`);

  it('adds nothing with the scoring a game had before there was any to set', () => {
    const answers = [row('anna', 0, 900, 4000), row('bela', 0, 800, 8000)];
    expect(worth(withBonuses(answers, questions))).toEqual(['anna0:900+0', 'bela0:800+0']);
  });

  it('gives the three fastest right answers of a question theirs - not on a map', () => {
    const scoring = { ...DEFAULT_SCORING, orderBonus: [300, 200, 100] };
    const answers = [
      row('anna', 0, 800, 8000),
      row('bela', 0, 0, 1000), // wrong, however fast
      row('cili', 0, 900, 4000),
      row('dani', 0, 700, 12000),
      row('emil', 0, 600, 16000),
      row('anna', 1, 950, 2000),
    ];
    expect(worth(withBonuses(answers, questions, scoring))).toEqual([
      'anna0:1000+200',
      'bela0:0+0',
      'cili0:1200+300',
      'dani0:800+100',
      'emil0:600+0',
      'anna1:950+0',
    ]);
  });

  it('pays a row of right answers more and more - a wrong or a missed one ends it, a map does not', () => {
    const scoring = { ...DEFAULT_SCORING, streakBonus: 100 };
    const answers = [
      row('anna', 0, 800, 1),
      row('anna', 1, 0, 1), // a pin far off: not counted either way
      row('anna', 2, 800, 1),
      row('anna', 3, 800, 1),
      row('bela', 0, 800, 2),
      row('bela', 2, 0, 2),
      row('bela', 3, 800, 2),
      row('cili', 0, 800, 3),
      row('cili', 3, 800, 3), // missed the one between
    ];
    expect(worth(withBonuses(answers, questions, scoring))).toEqual([
      'anna0:800+0',
      'anna1:0+0',
      'anna2:900+100',
      'anna3:1000+200',
      'bela0:800+0',
      'bela2:0+0',
      'bela3:800+0',
      'cili0:800+0',
      'cili3:800+0',
    ]);
  });

  it('stops growing after five steps', () => {
    const many = Array.from({ length: 8 }, () => ({ type: 'choice' }));
    const answers = many.map((_, i) => row('anna', i, 500, 1));
    const scored = withBonuses(answers, many, { ...DEFAULT_SCORING, streakBonus: 100 });
    expect(scored.map((r) => r.bonus)).toEqual([0, 100, 200, 300, 400, 500, 500, 500]);
  });
});

describe('cleanQuiz', () => {
  it('trims the texts and fills in the time limit', () => {
    const { quiz, error } = cleanQuiz({
      title: '  Táborok ',
      questions: [question({ text: ' Hol? ', answers: [' A ', 'B'], correct: 0 })],
    });
    expect(error).toBeUndefined();
    expect(quiz).toEqual({
      title: 'Táborok',
      questions: [
        {
          type: 'choice',
          text: 'Hol?',
          image: null,
          answers: ['A', 'B'],
          correct: 0,
          timeLimitSec: 20,
        },
      ],
    });
  });

  it('says what is wrong', () => {
    const bad = [
      [{}, 'címe'],
      [{ title: 'x'.repeat(81), questions: [question()] }, 'címe'],
      [{ title: 'Jó', questions: [] }, 'kérdés lehet'],
      [{ title: 'Jó', questions: [question({ text: ' ' })] }, '1. kérdés: a szövege'],
      [{ title: 'Jó', questions: [question({ answers: ['csak egy'] })] }, 'válasz kell'],
      [
        { title: 'Jó', questions: [question({ answers: ['a', 'b', 'c', 'd', 'e'] })] },
        'válasz kell',
      ],
      [{ title: 'Jó', questions: [question({ answers: ['a', ''] })] }, 'egy válasz'],
      [{ title: 'Jó', questions: [question(), question({ correct: 3 })] }, '2. kérdés: jelöld'],
      [{ title: 'Jó', questions: [question({ correct: '1' })] }, 'jelöld'],
      [{ title: 'Jó', questions: [question({ timeLimitSec: 7 })] }, 'gondolkodási idő'],
      [{ title: 'Jó', questions: [question({ type: 'essay' })] }, 'ismeretlen kérdéstípus'],
      [{ title: 'Jó', questions: [question({ type: 'picture' })] }, 'válassz képet'],
      [{ title: 'Jó', questions: [question({ type: 'picture', image: '../x' })] }, 'válassz képet'],
    ];
    for (const [body, part] of bad) {
      expect(cleanQuiz(body).error, JSON.stringify(body)).toContain(part);
    }
  });
});

describe('cleanQuiz: the kinds of question', () => {
  it('keeps a picture only on a picture question', () => {
    const image = 'a'.repeat(24);
    const { quiz } = cleanQuiz({
      title: 'Képek',
      questions: [question({ type: 'picture', image }), question({ image })],
    });
    expect(quiz.questions.map((q) => [q.type, q.image])).toEqual([
      ['picture', image],
      ['choice', null],
    ]);
  });
});

describe('standings', () => {
  it('ranks by points, then by the time the right answers took, then by who joined first', () => {
    const table = standings(
      ['anna', 'bela', 'cili', 'dani'],
      [
        { user: 'bela', points: 900, ms: 4000 },
        { user: 'anna', points: 900, ms: 3000 },
        { user: 'cili', points: 0, ms: 100 },
        { user: 'anna', points: 600, ms: 8000 },
        { user: 'bela', points: 600, ms: 6000 },
      ],
    );
    expect(table).toEqual([
      { user: 'bela', score: 1500, correct: 2, ms: 10000, rank: 1 },
      { user: 'anna', score: 1500, correct: 2, ms: 11000, rank: 2 },
      { user: 'cili', score: 0, correct: 0, ms: 0, rank: 3 },
      { user: 'dani', score: 0, correct: 0, ms: 0, rank: 4 },
    ]);
  });

  it('leaves out an answer of someone not in the game', () => {
    expect(standings(['anna'], [{ user: 'bela', points: 800, ms: 1 }])).toEqual([
      { user: 'anna', score: 0, correct: 0, ms: 0, rank: 1 },
    ]);
  });
});
