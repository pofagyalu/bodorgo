import { describe, expect, it } from 'vitest';
import { cleanQuiz, pointsFor, standings } from '../../src/jatekok/quiz/scoring.js';

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
