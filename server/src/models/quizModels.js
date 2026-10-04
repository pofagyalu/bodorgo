import mongoose from 'mongoose';
import { DEFAULT_TIME_LIMIT, QUESTION_TYPES, TIME_LIMITS } from '../jatekok/quiz/scoring.js';

const { Schema } = mongoose;

// A question: 2-4 answers, one of them right (see jatekok/quiz/scoring.js
// for what's valid - the controller checks it before anything is stored).
// Its kind: `choice` - a plain one; `picture` - with a picture (its name -
// see jatekok/quiz/quizImages.js) that is uncovered slowly while the clock
// runs. Only a picture question has an `image`.
const questionSchema = new Schema(
  {
    type: { type: String, enum: QUESTION_TYPES, default: 'choice' },
    text: { type: String, required: true, trim: true },
    image: { type: String, default: null },
    answers: { type: [String], required: true },
    // The right answer's place in `answers`.
    correct: { type: Number, required: true },
    timeLimitSec: { type: Number, enum: TIME_LIMITS, default: DEFAULT_TIME_LIMIT },
  },
  { _id: false },
);

// Móka → Kvíz: a quiz - its questions, written by one user. Everyone sees
// that it exists; its questions only its author (they'd give the answers
// away), who alone may change, delete or start it.
const quizSchema = new Schema(
  {
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
    questions: { type: [questionSchema], default: [] },
  },
  { timestamps: true },
);

quizSchema.index({ updatedAt: -1 });

// Someone's answer to one question: which one they tapped, how long after
// the question opened, and what it was worth (0: wrong).
const answerSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    questionIdx: { type: Number, required: true },
    answer: { type: Number, required: true },
    ms: { type: Number, required: true },
    points: { type: Number, required: true },
  },
  { _id: false },
);

const playerSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

// One playing of a quiz, led by its starter (the host, who doesn't play):
//   lobby → question → reveal → question → ... → reveal → finished
// The title and the questions are copied in at the start, so a quiz
// changed or deleted later leaves the games played as they were.
// `abandoned`: called off by the host - it counts for nothing.
const quizGameSchema = new Schema(
  {
    quiz: { type: Schema.Types.ObjectId, ref: 'Quiz', default: null },
    title: { type: String, required: true },
    questions: { type: [questionSchema], required: true },
    host: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // What the players type in to join - six digits, no two live games
    // share one.
    pin: { type: String, required: true },
    status: {
      type: String,
      enum: ['lobby', 'question', 'reveal', 'finished', 'abandoned'],
      default: 'lobby',
    },
    // The question that is open, or was last: -1 in the lobby.
    questionIdx: { type: Number, default: -1 },
    // The server's clock is the one that counts.
    questionStartedAt: { type: Date, default: null },
    // In joining order.
    players: { type: [playerSchema], default: [] },
    answers: { type: [answerSchema], default: [] },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

quizGameSchema.index({ createdAt: -1 });
quizGameSchema.index({ pin: 1, status: 1 });

export const LIVE_STATUSES = ['lobby', 'question', 'reveal'];

export const Quiz = mongoose.model('Quiz', quizSchema);
export const QuizGame = mongoose.model('QuizGame', quizGameSchema);
