import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import multer from 'multer';
import QRCode from 'qrcode';
import config from '../config.js';
import logger from '../logger.js';
import { LIVE_STATUSES, Quiz, QuizGame } from '../models/quizModels.js';
import Tour from '../models/tourModel.js';
import AppError from '../utils/appError.js';
import { cleanQuiz, pointsFor, standings } from '../jatekok/quiz/scoring.js';
import { emitToQuiz } from '../jatekok/quiz/quizSocket.js';
import {
  deleteUnusedQuizImages,
  quizImageExists,
  quizImagePath,
  saveQuizImage,
} from '../jatekok/quiz/quizImages.js';
import { LONG_CACHE } from '../photos/imageSizes.js';

// Móka → Kvíz. A quiz is written by one user, who alone may change, delete
// or start it. A game is one playing of it: its starter leads (and doesn't
// play), everyone else joins from their own phone with the game's code.
// Everything is done here, over REST; after each change the game as it now
// stands goes out to everyone watching it (jatekok/quiz/quizSocket.js).
// The server's clock is the one that counts: a question opens and closes
// here, and an answer is timed by when it arrives.

const MAX_PLAYERS = 100;
// An answer tapped at the last moment still has to travel here.
export const GRACE_MS = 500;

const PLAYER_SELECT = 'name username photoUpdatedAt';
const refId = (ref) => String(ref?._id ?? ref);
// What the app calls someone: their username, or their name without one.
const shownName = (user) => user?.username || user?.name || 'Ismeretlen';
const person = (user) => ({ _id: refId(user), name: shownName(user) });

// --- The quizzes ---

// The questions (they'd give the answers away) only with `full`.
const quizView = (quiz, user, full = false) => ({
  _id: quiz._id,
  title: quiz.title,
  questionCount: quiz.questions.length,
  createdBy: person(quiz.createdBy),
  createdAt: quiz.createdAt,
  updatedAt: quiz.updatedAt,
  mine: refId(quiz.createdBy) === refId(user),
  ...(full && {
    questions: quiz.questions.map((q) => ({
      type: q.type,
      text: q.text,
      image: q.image ?? null,
      answers: q.answers,
      correct: q.correct,
      timeLimitSec: q.timeLimitSec,
    })),
  }),
});

// The quiz as sent in, cleaned (jatekok/quiz/scoring.js) - the error if it
// won't do, or if a picture it names isn't there.
function quizFrom(body) {
  const { quiz, error } = cleanQuiz(body);
  if (error) throw new AppError(error, 400);
  const lost = quiz.questions.findIndex((q) => q.image && !quizImageExists(q.image));
  if (lost >= 0) {
    throw new AppError(`${lost + 1}. kérdés: a képe nem található – válaszd ki újra.`, 400);
  }
  return quiz;
}

const imagesOf = (quiz) => quiz.questions.map((q) => q.image).filter(Boolean);

// The quiz, if it's this user's own - the error otherwise.
async function ownQuiz(req) {
  const quiz = mongoose.isValidObjectId(req.params.id)
    ? await Quiz.findById(req.params.id).populate({ path: 'createdBy', select: 'name username' })
    : null;
  if (!quiz) throw new AppError('Nincs ilyen kvíz.', 404);
  if (refId(quiz.createdBy) !== refId(req.user)) {
    throw new AppError('Ehhez a kvízhez csak a készítője nyúlhat.', 403);
  }
  return quiz;
}

const sendQuiz = (res, quiz, user, code = 200) =>
  res.status(code).json({ status: 'success', data: { quiz: quizView(quiz, user, true) } });

// GET /jatekok/quiz/quizzes - every quiz, the last changed first, without
// the questions.
export const getQuizzes = async (req, res) => {
  const quizzes = await Quiz.find()
    .sort('-updatedAt')
    .limit(200)
    .populate({ path: 'createdBy', select: 'name username' });
  res.status(200).json({
    status: 'success',
    data: { quizzes: quizzes.map((q) => quizView(q, req.user)) },
  });
};

// POST /jatekok/quiz/quizzes
export const createQuiz = async (req, res) => {
  const created = await Quiz.create({ ...quizFrom(req.body), createdBy: req.user._id });
  sendQuiz(
    res,
    await created.populate({ path: 'createdBy', select: 'name username' }),
    req.user,
    201,
  );
};

// GET /jatekok/quiz/quizzes/:id - with its questions: the author's only.
export const getQuiz = async (req, res) => {
  sendQuiz(res, await ownQuiz(req), req.user);
};

// PUT /jatekok/quiz/quizzes/:id - the whole quiz replaced. The games
// already played keep the questions (and pictures) they were played with.
export const updateQuiz = async (req, res) => {
  const stored = await ownQuiz(req);
  const quiz = quizFrom(req.body);
  const before = imagesOf(stored);
  stored.title = quiz.title;
  stored.questions = quiz.questions;
  await stored.save();
  await deleteUnusedQuizImages(before);
  sendQuiz(res, stored, req.user);
};

// DELETE /jatekok/quiz/quizzes/:id - the games played from it stay.
export const deleteQuiz = async (req, res) => {
  const quiz = await ownQuiz(req);
  await quiz.deleteOne();
  await deleteUnusedQuizImages(imagesOf(quiz));
  res.status(204).send();
};

// --- A question's picture (jatekok/quiz/quizImages.js) ---

// The phone shrinks the photo first, so this is just a generous ceiling.
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new AppError('Csak kép tölthető fel.', 400));
      return;
    }
    cb(null, true);
  },
}).single('image');

// multer's own "too big" error as a message the editor can show.
export const quizImageUpload = (req, res, next) =>
  upload(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError('Túl nagy a kép (legfeljebb 12 MB).', 400));
    }
    next(err);
  });

const sendImageName = (res, image) => res.status(201).json({ status: 'success', data: { image } });

// POST /jatekok/quiz/images - multipart: image. A picture of one's own for
// a question; the answer is the name the question then carries.
export const uploadImage = async (req, res) => {
  if (!req.file) throw new AppError('Nincs kép kiválasztva.', 400);
  let image;
  try {
    image = await saveQuizImage(req.file.buffer);
  } catch (err) {
    logger.warn(`quiz image could not be read: ${err.message}`);
    throw new AppError('Ez a fájl nem kép, vagy nem olvasható.', 400);
  }
  sendImageName(res, image);
};

// POST /jatekok/quiz/images/from-tour - { tourId, filename }: a photo of a
// tour's album, copied for the quiz. Not a restricted one - in a quiz
// everybody would see it.
export const imageFromTour = async (req, res) => {
  const { tourId, filename } = req.body ?? {};
  const tour =
    mongoose.isValidObjectId(tourId) && typeof filename === 'string'
      ? await Tour.findById(tourId).select('+images +sourceFolder')
      : null;
  const photo = tour?.images.find((i) => i.filename === filename);
  if (!photo || photo.restricted || !tour.sourceFolder) {
    throw new AppError('Nincs ilyen fénykép ehhez a táborhoz.', 404);
  }
  // Never outside the tour's own folder, whatever the name says.
  const baseDir = path.resolve(config.photosRoot, tour.sourceFolder);
  const file = path.resolve(baseDir, filename);
  if (!file.startsWith(baseDir + path.sep) || !fs.existsSync(file)) {
    throw new AppError('A fénykép nem található a lemezen.', 404);
  }
  sendImageName(res, await saveQuizImage(file));
};

// GET /jatekok/quiz/images/:name - the picture itself, for <img>. It never
// changes under its name - browsers may keep it.
export const getImage = async (req, res) => {
  if (!quizImageExists(req.params.name)) throw new AppError('Nincs ilyen kép.', 404);
  res.set('Cache-Control', LONG_CACHE);
  res.sendFile(quizImagePath(req.params.name));
};

// --- A game ---

const isLive = (game) => LIVE_STATUSES.includes(game.status);
const isHost = (game, user) => refId(game.host) === refId(user);
const limitMs = (game) => game.questions[game.questionIdx].timeLimitSec * 1000;
const endsAt = (game) => game.questionStartedAt.getTime() + limitMs(game);
// Someone whose user has since been deleted is left out.
const playersOf = (game) => game.players.filter((p) => p.user);
const isPlayer = (game, user) => playersOf(game).some((p) => refId(p.user) === refId(user));

const findGame = (id) =>
  QuizGame.findById(id)
    .populate({ path: 'players.user', select: PLAYER_SELECT })
    .populate({ path: 'host', select: 'name username' });

// The game as everyone may see it: the question without its right answer
// while it's open, and the scores without the open question's answers
// (they'd show who has just got it right).
function gameView(game) {
  const idx = game.questionIdx;
  const question = game.questions[idx];
  const open = game.status === 'question';
  const reveal = game.status === 'reveal';
  const current = game.answers.filter((a) => a.questionIdx === idx);
  const counted = open ? game.answers.filter((a) => a.questionIdx !== idx) : game.answers;
  const people = new Map(playersOf(game).map((p) => [refId(p.user), p.user]));
  const table = standings([...people.keys()], counted);

  return {
    _id: game._id,
    title: game.title,
    // Only while there's something to join.
    pin: isLive(game) ? game.pin : null,
    status: game.status,
    host: person(game.host),
    createdAt: game.createdAt,
    finishedAt: game.finishedAt,
    questionCount: game.questions.length,
    questionIdx: idx,
    // Best first.
    players: table.map((row) => {
      const user = people.get(row.user);
      const mine = current.find((a) => refId(a.user) === row.user);
      return {
        userId: row.user,
        name: shownName(user),
        photoUpdatedAt: user.photoUpdatedAt ?? null,
        score: row.score,
        correct: row.correct,
        rank: row.rank,
        // The open (or just closed) question.
        answered: !!mine,
        ...(reveal && { answer: mine?.answer ?? null, points: mine?.points ?? 0 }),
      };
    }),
    question:
      open || reveal
        ? {
            type: question.type,
            text: question.text,
            // A picture question's: uncovered slowly while the clock runs.
            image: question.image ?? null,
            answers: question.answers,
            timeLimitSec: question.timeLimitSec,
            startedAt: game.questionStartedAt,
            endsAt: new Date(endsAt(game)),
            ...(reveal && {
              correct: question.correct,
              // How many tapped each answer.
              counts: question.answers.map((_, i) => current.filter((a) => a.answer === i).length),
            }),
          }
        : null,
    // For the countdown: the phone's own clock may be off.
    serverNow: new Date(),
  };
}

// The game in the list: who won it, not how.
function gameSummary(game) {
  const people = new Map(playersOf(game).map((p) => [refId(p.user), p.user]));
  const table = standings([...people.keys()], game.answers);
  return {
    _id: game._id,
    title: game.title,
    status: game.status,
    host: person(game.host),
    createdAt: game.createdAt,
    finishedAt: game.finishedAt,
    questionCount: game.questions.length,
    playerCount: people.size,
    winners:
      game.status === 'finished'
        ? table.slice(0, 3).map((row) => ({
            place: row.rank,
            userId: row.user,
            name: shownName(people.get(row.user)),
            photoUpdatedAt: people.get(row.user).photoUpdatedAt ?? null,
            score: row.score,
          }))
        : [],
  };
}

// The game as it now stands, to everyone watching it.
async function broadcast(gameId) {
  const game = await findGame(gameId);
  if (game) emitToQuiz(gameId, 'quiz-game', gameView(game));
}

// Each open question's clock: it closes by itself when the time is up.
const clocks = new Map();

function stopClock(gameId) {
  clearTimeout(clocks.get(String(gameId)));
  clocks.delete(String(gameId));
}

function startClock(game) {
  stopClock(game._id);
  const { _id, questionIdx } = game;
  const timer = setTimeout(
    () =>
      closeQuestion(_id, questionIdx).catch((err) =>
        logger.error(`quiz: closing a question failed: ${err.message}`),
      ),
    Math.max(0, endsAt(game) - Date.now()) + GRACE_MS,
  );
  // Never the reason the server stays up.
  timer.unref();
  clocks.set(String(_id), timer);
}

// Only if that question is still the open one: the clock, the host and the
// last answer may all get here at once - one of them closes it.
async function closeQuestion(gameId, questionIdx) {
  stopClock(gameId);
  const result = await QuizGame.updateOne(
    { _id: gameId, status: 'question', questionIdx },
    { status: 'reveal' },
  );
  if (result.modifiedCount) await broadcast(gameId);
}

// The next question opens - only from where the game was seen to stand.
async function openQuestion(game, questionIdx) {
  const result = await QuizGame.updateOne(
    { _id: game._id, status: game.status, questionIdx: game.questionIdx },
    { status: 'question', questionIdx, questionStartedAt: new Date() },
  );
  if (!result.modifiedCount) return;
  startClock(await QuizGame.findById(game._id));
  await broadcast(game._id);
}

// The game for a request - the error if there's none. A question whose
// time is up is closed first (its clock is lost if the server restarts).
async function loadGame(id) {
  if (!mongoose.isValidObjectId(id)) throw new AppError('Nincs ilyen játék.', 404);
  let game = await findGame(id);
  if (!game) throw new AppError('Nincs ilyen játék.', 404);
  if (game.status === 'question' && Date.now() > endsAt(game) + GRACE_MS) {
    await closeQuestion(game._id, game.questionIdx);
    game = await findGame(id);
  }
  return game;
}

// The game its host may lead - the error otherwise.
async function gameToLead(req) {
  const game = await loadGame(req.params.id);
  if (!isHost(game, req.user)) throw new AppError('Ezt a játékot nem te vezeted.', 403);
  if (!isLive(game)) throw new AppError('Ez a játék már véget ért.', 400);
  return game;
}

// With what only this user may know: their own answer to the open question.
async function sendGame(res, gameId, user, code = 200) {
  const game = await findGame(gameId);
  const mine = game.answers.find(
    (a) => a.questionIdx === game.questionIdx && refId(a.user) === refId(user),
  );
  res.status(code).json({
    status: 'success',
    data: { game: { ...gameView(game), myAnswer: mine?.answer ?? null } },
  });
}

// Six digits no other live game has.
async function freePin() {
  for (let i = 0; i < 20; i++) {
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    if (!(await QuizGame.exists({ pin, status: { $in: LIVE_STATUSES } }))) return pin;
  }
  throw new AppError('Most nem sikerült kódot adni a játéknak – próbáld újra.', 503);
}

// POST /jatekok/quiz/quizzes/:id/games - the author starts a game of their
// quiz: it waits in the lobby for the players.
export const startGame = async (req, res) => {
  const quiz = await ownQuiz(req);
  if (!quiz.questions.length) throw new AppError('Ebben a kvízben nincs kérdés.', 400);
  const game = await QuizGame.create({
    quiz: quiz._id,
    title: quiz.title,
    questions: quiz.questions.map((q) => q.toObject()),
    host: req.user._id,
    pin: await freePin(),
  });
  await sendGame(res, game._id, req.user, 201);
};

// GET /jatekok/quiz/games - everyone's games, the newest first: the ones
// on now to join, the finished ones with their winners. Not the ones
// called off.
export const getGames = async (req, res) => {
  const games = await QuizGame.find({ status: { $ne: 'abandoned' } })
    .sort('-createdAt')
    .limit(100)
    .populate({ path: 'players.user', select: PLAYER_SELECT })
    .populate({ path: 'host', select: 'name username' });
  res.status(200).json({ status: 'success', data: { games: games.map(gameSummary) } });
};

// GET /jatekok/quiz/leaderboard - who stood on the podium how often, over
// every finished game. Best first: the most wins, then 2nd and 3rd places,
// then the points.
export const getLeaderboard = async (req, res) => {
  const games = await QuizGame.find({ status: 'finished' }).populate({
    path: 'players.user',
    select: PLAYER_SELECT,
  });

  const rows = new Map();
  for (const game of games) {
    const people = new Map(playersOf(game).map((p) => [refId(p.user), p.user]));
    for (const place of standings([...people.keys()], game.answers)) {
      const user = people.get(place.user);
      if (!rows.has(place.user)) {
        rows.set(place.user, {
          userId: place.user,
          name: shownName(user),
          photoUpdatedAt: user.photoUpdatedAt ?? null,
          games: 0,
          firsts: 0,
          seconds: 0,
          thirds: 0,
          points: 0,
          correct: 0,
        });
      }
      const row = rows.get(place.user);
      row.games += 1;
      if (place.rank === 1) row.firsts += 1;
      if (place.rank === 2) row.seconds += 1;
      if (place.rank === 3) row.thirds += 1;
      row.points += place.score;
      row.correct += place.correct;
    }
  }

  const players = [...rows.values()].sort(
    (a, b) =>
      b.firsts - a.firsts ||
      b.seconds - a.seconds ||
      b.thirds - a.thirds ||
      b.points - a.points ||
      a.name.localeCompare(b.name, 'hu'),
  );
  res.status(200).json({ status: 'success', data: { players } });
};

// GET /jatekok/quiz/games/pin/:pin - which live game this code belongs to.
export const findByPin = async (req, res) => {
  const game = await QuizGame.findOne({
    pin: String(req.params.pin).trim(),
    status: { $in: LIVE_STATUSES },
  }).select('_id');
  if (!game) throw new AppError('Ilyen kóddal most nincs játék.', 404);
  res.status(200).json({ status: 'success', data: { gameId: game._id } });
};

// GET /jatekok/quiz/games/:id
export const getGame = async (req, res) => {
  const game = await loadGame(req.params.id);
  await sendGame(res, game._id, req.user);
};

// GET /jatekok/quiz/games/:id/qr?origin= - the game's link as a QR code (a
// PNG data URL) for the host's screen: whoever scans it lands in the game.
// The link is on the app the host is using - one of the known ones only.
export const getGameQr = async (req, res) => {
  const game = await gameToLead(req);
  const origin = String(req.query.origin ?? '').replace(/\/$/, '');
  if (!config.corsOrigins.includes(origin)) throw new AppError('Ismeretlen cím.', 400);
  const url = `${origin}/moka/kviz/jatekok/${game._id}`;
  const qr = await QRCode.toDataURL(url, { width: 480, margin: 1 });
  res.status(200).json({ status: 'success', data: { url, qr } });
};

// POST /jatekok/quiz/games/:id/join - into a game still on, at any point
// (a latecomer has no points for what they missed). Joining again changes
// nothing.
export const joinGame = async (req, res) => {
  const game = await loadGame(req.params.id);
  if (isHost(game, req.user)) throw new AppError('A játékvezető nem játszik.', 400);
  if (!isLive(game)) throw new AppError('Ez a játék már véget ért.', 400);
  if (!isPlayer(game, req.user)) {
    if (game.players.length >= MAX_PLAYERS) throw new AppError('Ez a játék megtelt.', 400);
    const result = await QuizGame.updateOne(
      {
        _id: game._id,
        status: { $in: LIVE_STATUSES },
        'players.user': { $ne: req.user._id },
      },
      { $push: { players: { user: req.user._id } } },
    );
    if (result.modifiedCount) await broadcast(game._id);
  }
  await sendGame(res, game._id, req.user);
};

// POST /jatekok/quiz/games/:id/next - the host's one button: the first
// question from the lobby; an open question closed early; from the answers
// shown the next question - or, after the last one, the end.
export const nextStep = async (req, res) => {
  const game = await gameToLead(req);
  const last = game.questionIdx === game.questions.length - 1;

  if (game.status === 'lobby') {
    if (!playersOf(game).length) throw new AppError('Még senki sem csatlakozott.', 400);
    await openQuestion(game, 0);
  } else if (game.status === 'question') {
    await closeQuestion(game._id, game.questionIdx);
  } else if (last) {
    const result = await QuizGame.updateOne(
      { _id: game._id, status: 'reveal' },
      { status: 'finished', finishedAt: new Date() },
    );
    if (result.modifiedCount) await broadcast(game._id);
  } else {
    await openQuestion(game, game.questionIdx + 1);
  }
  await sendGame(res, game._id, req.user);
};

// POST /jatekok/quiz/games/:id/answers - a player's answer to the open
// question: one each, timed by when it gets here. Once everyone has
// answered, the question closes without waiting for the clock.
export const answerQuestion = async (req, res) => {
  const game = await loadGame(req.params.id);
  if (!isPlayer(game, req.user)) throw new AppError('Ebben a játékban nem játszol.', 403);
  if (game.status !== 'question')
    throw new AppError('Erre a kérdésre már nem lehet válaszolni.', 400);

  const { questionIdx } = game;
  const question = game.questions[questionIdx];
  const answer = req.body?.answer;
  if (!Number.isInteger(answer) || answer < 0 || answer >= question.answers.length) {
    throw new AppError('Ilyen válasz nincs.', 400);
  }
  const ms = Date.now() - game.questionStartedAt.getTime();
  const points = answer === question.correct ? pointsFor(ms, limitMs(game)) : 0;

  // In one step, so two taps (or two phones) can't both count.
  const result = await QuizGame.updateOne(
    {
      _id: game._id,
      status: 'question',
      questionIdx,
      'players.user': req.user._id,
      answers: { $not: { $elemMatch: { user: req.user._id, questionIdx } } },
    },
    { $push: { answers: { user: req.user._id, questionIdx, answer, ms, points } } },
  );
  if (!result.modifiedCount) {
    throw new AppError('Erre a kérdésre már válaszoltál, vagy lejárt az idő.', 400);
  }

  const now = await QuizGame.findById(game._id).select('players answers');
  const answered = now.answers.filter((a) => a.questionIdx === questionIdx).length;
  if (answered >= now.players.length) await closeQuestion(game._id, questionIdx);
  else await broadcast(game._id);
  await sendGame(res, game._id, req.user);
};

// POST /jatekok/quiz/games/:id/abandon - the host calls it off: it's gone
// from the list, and counts for nothing.
export const abandonGame = async (req, res) => {
  const game = await gameToLead(req);
  stopClock(game._id);
  await QuizGame.updateOne(
    { _id: game._id, status: { $in: LIVE_STATUSES } },
    { status: 'abandoned' },
  );
  await broadcast(game._id);
  await sendGame(res, game._id, req.user);
};
