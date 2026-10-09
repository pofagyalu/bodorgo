// Móka → Kvíz: the rules - what a quiz may look like, what an answer is
// worth, and who stands where. Nothing here touches the database.

// The kinds of question:
// - `choice`: a plain one;
// - `picture`: with a picture uncovered tile by tile while the clock runs;
// - `zoom`: with a picture that starts on a detail and zooms out;
// - `truefalse`: a statement - true or false;
// - `song`: a song plays (on the host's device), which one is it;
// - `map`: where is it - everyone puts a pin on the map, the closest wins.
// All but `map` are answered by picking one of the answers.
export const QUESTION_TYPES = ['choice', 'picture', 'zoom', 'truefalse', 'song', 'map'];
export const hasPicture = (type) => type === 'picture' || type === 'zoom';
export const TRUE_FALSE = ['Igaz', 'Hamis'];

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

// A right answer at once - and a pin right on the place - is worth this
// much, always.
export const BASE_POINTS = 1000;

// The rest of the scoring is set on Móka → Kvíz → Pontozás (by the role
// manager). A game takes it as it stands when its first question opens,
// and keeps it to its end - a game played before there was any such
// setting was scored with these:
// - minPoints: what a right answer is worth at the last moment;
// - orderBonus: on top, for the fastest, 2nd and 3rd fastest right answer
//   to a question;
// - mapReachPct: how far a pin may be to be worth anything, in % of the
//   shown map's diagonal;
// - streakBonus: on top, for each right answer in a row after the first
//   (the 2nd in a row gets it once, the 3rd twice... at most
//   MAX_STREAK_STEPS times).
export const DEFAULT_SCORING = {
  minPoints: 500,
  orderBonus: [0, 0, 0],
  mapReachPct: 50,
  streakBonus: 0,
};
// What the next games get until the role manager sets something else: as
// above, with a bonus for the three fastest.
export const INITIAL_SCORING = { ...DEFAULT_SCORING, orderBonus: [300, 200, 100] };
export const MAX_STREAK_STEPS = 5;
export const MIN_MAP_REACH = 5;
export const MAX_MAP_REACH = 100;

const isWhole = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

// The scoring as sent in, cleaned - or the reason (in Hungarian) why it
// won't do.
export function cleanScoring(body) {
  const { minPoints, orderBonus, mapReachPct, streakBonus } = body ?? {};
  if (!isWhole(minPoints, 1, BASE_POINTS)) {
    return { error: `Az utolsó pillanat pontja 1 és ${BASE_POINTS} közötti egész szám lehet.` };
  }
  if (
    !Array.isArray(orderBonus) ||
    orderBonus.length !== 3 ||
    !orderBonus.every((b) => isWhole(b, 0, BASE_POINTS))
  ) {
    return { error: `A leggyorsabbak bónusza 0 és ${BASE_POINTS} közötti egész szám lehet.` };
  }
  if (!isWhole(mapReachPct, MIN_MAP_REACH, MAX_MAP_REACH)) {
    return {
      error: `A térképes távolság ${MIN_MAP_REACH} és ${MAX_MAP_REACH} százalék között lehet.`,
    };
  }
  if (!isWhole(streakBonus, 0, BASE_POINTS)) {
    return { error: `A sorozatbónusz 0 és ${BASE_POINTS} közötti egész szám lehet.` };
  }
  return { scoring: { minPoints, orderBonus: [...orderBonus], mapReachPct, streakBonus } };
}

// What a right answer is worth after `ms` of a question open for `limitMs`:
// the faster, the more - from BASE_POINTS down to `minPoints`.
export function pointsFor(ms, limitMs, minPoints = DEFAULT_SCORING.minPoints) {
  const used = Math.min(Math.max(ms, 0), limitMs) / limitMs;
  return Math.round(BASE_POINTS - (BASE_POINTS - minPoints) * used);
}

// The answers with what they are worth in the end: each one's own points
// (as stored) and the bonuses of the game's scoring on top - `bonus` says
// how much of `points` those are. Worked out from the answers each time,
// never stored: who was the fastest is only certain once a question is
// closed. A map question is not about speed: no bonus on it, and it
// neither breaks nor lengthens a row of right answers.
export function withBonuses(answers, questions, scoring = DEFAULT_SCORING) {
  const rows = answers.map((a) => ({
    user: String(a.user),
    questionIdx: a.questionIdx,
    answer: a.answer,
    lat: a.lat,
    lng: a.lng,
    ms: a.ms,
    points: a.points,
    bonus: 0,
  }));
  const bySpeed = (idx) => questions[idx] && questions[idx].type !== 'map';
  const right = rows.filter((r) => r.points > 0 && bySpeed(r.questionIdx));

  // The fastest three of each question (of two just as fast, whoever's
  // answer got here first).
  const perQuestion = new Map();
  for (const row of right) {
    perQuestion.set(row.questionIdx, [...(perQuestion.get(row.questionIdx) ?? []), row]);
  }
  for (const list of perQuestion.values()) {
    list.sort((a, b) => a.ms - b.ms);
    list.slice(0, 3).forEach((row, i) => (row.bonus += scoring.orderBonus[i] ?? 0));
  }

  // Each player's rows of right answers: a wrong or a missing one ends it.
  if (scoring.streakBonus) {
    const perUser = new Map();
    for (const row of right) {
      if (!perUser.has(row.user)) perUser.set(row.user, new Map());
      perUser.get(row.user).set(row.questionIdx, row);
    }
    for (const mine of perUser.values()) {
      let run = 0;
      for (let idx = 0; idx < questions.length; idx++) {
        if (!bySpeed(idx)) continue;
        const row = mine.get(idx);
        run = row ? run + 1 : 0;
        if (row) row.bonus += scoring.streakBonus * Math.min(run - 1, MAX_STREAK_STEPS);
      }
    }
  }

  for (const row of rows) row.points += row.bonus;
  return rows;
}

// --- The map ---

const EARTH_KM = 6371;
const rad = (deg) => (deg * Math.PI) / 180;

// As the crow flies, in km.
export function distanceKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// What a pin is worth: BASE_POINTS right on the place, less and less with
// the distance - nothing from `reachPct` % of the shown map's diagonal
// away. Not by speed: a pin may be moved until the time is up.
export function mapPoints(place, guess, bounds, reachPct = DEFAULT_SCORING.mapReachPct) {
  const diagonal = distanceKm(
    { lat: bounds.south, lng: bounds.west },
    { lat: bounds.north, lng: bounds.east },
  );
  const off = distanceKm(place, guess) / ((diagonal * reachPct) / 100);
  return Math.round(BASE_POINTS * Math.max(0, 1 - off));
}

const isNumber = (n) => typeof n === 'number' && Number.isFinite(n);
const isLat = (n) => isNumber(n) && n >= -90 && n <= 90;
const isLng = (n) => isNumber(n) && n >= -180 && n <= 180;
export const isPlace = (p) => isLat(p?.lat) && isLng(p?.lng);

// A map question's own: the place, and the part of the map that's shown
// (the place must be on it) - null if they won't do.
function cleanMap(q) {
  const { place, bounds: b } = q;
  if (!isPlace(place)) return null;
  if (!isLat(b?.south) || !isLat(b?.north) || !isLng(b?.west) || !isLng(b?.east)) return null;
  if (b.south >= b.north || b.west >= b.east) return null;
  if (place.lat < b.south || place.lat > b.north || place.lng < b.west || place.lng > b.east) {
    return null;
  }
  return {
    place: { lat: place.lat, lng: place.lng },
    bounds: { south: b.south, west: b.west, north: b.north, east: b.east },
  };
}

// --- A quiz ---

// The answers to pick from and the right one's place - or the reason why
// they won't do.
function cleanAnswers(q, nr) {
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
  return { answers, correct: q.correct };
}

// The quiz as sent in, cleaned - or the reason (in Hungarian) why it won't
// do. Each question keeps only what its kind has. (That a picture or a song
// it names is really there is the controller's to check.)
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
    const type = q?.type ?? 'choice';
    if (!QUESTION_TYPES.includes(type)) return { error: `${nr}: ismeretlen kérdéstípus.` };
    const text = typeof q?.text === 'string' ? q.text.trim() : '';
    if (!text || text.length > MAX_QUESTION_TEXT) {
      return { error: `${nr}: a szövege 1-${MAX_QUESTION_TEXT} karakter lehet.` };
    }
    const timeLimitSec = q.timeLimitSec ?? DEFAULT_TIME_LIMIT;
    if (!TIME_LIMITS.includes(timeLimitSec)) {
      return { error: `${nr}: a gondolkodási idő ${TIME_LIMITS.join(', ')} másodperc lehet.` };
    }
    const question = { type, text, timeLimitSec, answers: [], correct: 0, image: null };

    if (type === 'map') {
      const map = cleanMap(q);
      if (!map) return { error: `${nr}: jelöld be a helyet a térképen.` };
      Object.assign(question, map);
    } else if (type === 'truefalse') {
      if (q.correct !== 0 && q.correct !== 1) {
        return { error: `${nr}: jelöld meg, hogy igaz vagy hamis.` };
      }
      Object.assign(question, { answers: TRUE_FALSE, correct: q.correct });
    } else {
      const { error, ...answers } = cleanAnswers(q, nr);
      if (error) return { error };
      Object.assign(question, answers);
    }

    if (hasPicture(type)) {
      if (typeof q.image !== 'string' || !/^[0-9a-f]{24}$/.test(q.image)) {
        return { error: `${nr}: ehhez a kérdéshez válassz képet.` };
      }
      question.image = q.image;
    }
    if (type === 'zoom') {
      // The detail it starts on: where in the picture's box, 0-1 each way.
      const { x = 0.5, y = 0.5 } = q.focus ?? {};
      const inBox = (n) => isNumber(n) && n >= 0 && n <= 1;
      if (!inBox(x) || !inBox(y)) return { error: `${nr}: jelöld meg, honnan induljon a kép.` };
      question.focus = { x, y };
    }
    if (type === 'song') {
      const { playlist, id } = q.song ?? {};
      if (typeof playlist !== 'string' || typeof id !== 'string' || !playlist || !id) {
        return { error: `${nr}: válassz hozzá dalt.` };
      }
      question.song = { playlist, id };
    }
    cleaned.push(question);
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
