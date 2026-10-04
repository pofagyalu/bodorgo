// Móka → Kvíz: the rules - what a quiz may look like, what an answer is
// worth, and who stands where. Nothing here touches the database.

// A question has 2-4 answers, exactly one of them right.
export const MIN_ANSWERS = 2;
export const MAX_ANSWERS = 4;
export const MAX_QUESTIONS = 50;
export const MAX_TITLE = 80;
export const MAX_QUESTION_TEXT = 300;
export const MAX_ANSWER_TEXT = 120;
// How long a question may stay open, in seconds.
export const TIME_LIMITS = [10, 20, 30, 60];
export const DEFAULT_TIME_LIMIT = 20;

// A right answer at once is worth this much; at the last moment, half.
export const BASE_POINTS = 1000;

// What a right answer is worth after `ms` of a question open for `limitMs`:
// the faster, the more - from BASE_POINTS down to half of it.
export function pointsFor(ms, limitMs) {
  const used = Math.min(Math.max(ms, 0), limitMs) / limitMs;
  return Math.round(BASE_POINTS * (1 - used / 2));
}

// The quiz as sent in, cleaned - or the reason (in Hungarian) why it won't do.
export function cleanQuiz(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > MAX_TITLE) {
    return { error: `A kvíz címe 1-${MAX_TITLE} karakter lehet.` };
  }
  const questions = body?.questions;
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > MAX_QUESTIONS) {
    return { error: `Egy kvízben 1-${MAX_QUESTIONS} kérdés lehet.` };
  }

  const cleaned = [];
  for (const [i, q] of questions.entries()) {
    const nr = `${i + 1}. kérdés`;
    const text = typeof q?.text === 'string' ? q.text.trim() : '';
    if (!text || text.length > MAX_QUESTION_TEXT) {
      return { error: `${nr}: a szövege 1-${MAX_QUESTION_TEXT} karakter lehet.` };
    }
    if (
      !Array.isArray(q.answers) ||
      q.answers.length < MIN_ANSWERS ||
      q.answers.length > MAX_ANSWERS
    ) {
      return { error: `${nr}: ${MIN_ANSWERS}-${MAX_ANSWERS} válasz kell hozzá.` };
    }
    const answers = q.answers.map((a) => (typeof a === 'string' ? a.trim() : ''));
    if (answers.some((a) => !a || a.length > MAX_ANSWER_TEXT)) {
      return { error: `${nr}: egy válasz 1-${MAX_ANSWER_TEXT} karakter lehet.` };
    }
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= answers.length) {
      return { error: `${nr}: jelöld meg a helyes választ.` };
    }
    const timeLimitSec = q.timeLimitSec ?? DEFAULT_TIME_LIMIT;
    if (!TIME_LIMITS.includes(timeLimitSec)) {
      return { error: `${nr}: a gondolkodási idő ${TIME_LIMITS.join(', ')} másodperc lehet.` };
    }
    // A picture question: the name of its picture (quizImages.js).
    const image = q.image ?? null;
    if (image !== null && !/^[0-9a-f]{24}$/.test(image)) {
      return { error: `${nr}: a képe nem található – válaszd ki újra.` };
    }
    cleaned.push({ text, image, answers, correct: q.correct, timeLimitSec });
  }
  return { quiz: { title, questions: cleaned } };
}

// Who stands where: `playerIds` in joining order, `answers` the ones that
// count ({ user, points, ms }). The most points first; on a tie whoever
// needed less time for their right answers, then whoever joined earlier.
// Everyone gets a place of their own (1, 2, 3...).
export function standings(playerIds, answers) {
  const rows = playerIds.map((id, joined) => ({
    user: String(id),
    joined,
    score: 0,
    correct: 0,
    ms: 0,
  }));
  const byUser = new Map(rows.map((r) => [r.user, r]));
  for (const a of answers) {
    const row = byUser.get(String(a.user));
    if (!row || !a.points) continue;
    row.score += a.points;
    row.correct += 1;
    row.ms += a.ms;
  }
  return rows
    .sort((a, b) => b.score - a.score || a.ms - b.ms || a.joined - b.joined)
    .map(({ joined, ...row }, i) => ({ ...row, rank: i + 1 }));
}
