import mongoose from 'mongoose';
import { DEFAULT_TIME_LIMIT, QUESTION_TYPES, TIME_LIMITS } from '../jatekok/quiz/scoring.js';

const { Schema } = mongoose;

const placeSchema = new Schema({ lat: Number, lng: Number }, { _id: false });

// A question, of one of the kinds in jatekok/quiz/scoring.js (which also
// says what's valid - the controller checks it before anything is stored).
// Every kind but `map` has 2-4 answers, one of them right; the rest is each
// kind's own, absent on the others.
const questionSchema = new Schema(
  {
    type: { type: String, enum: QUESTION_TYPES, default: 'choice' },
    text: { type: String, required: true, trim: true },
    answers: { type: [String], default: [] },
    // The right answer's place in `answers`.
    correct: { type: Number, default: 0 },
    timeLimitSec: { type: Number, enum: TIME_LIMITS, default: DEFAULT_TIME_LIMIT },
    // picture, zoom: the picture's name (see jatekok/quiz/quizImages.js).
    image: { type: String, default: null },
    // zoom: the detail it starts on - where in the picture's box, 0-1.
    focus: { type: new Schema({ x: Number, y: Number }, { _id: false }), default: undefined },
    // song: which song of which playlist (music/jellyfin.js) - and what it
    // is, as it was when the question was written.
    song: {
      type: new Schema(
        { playlist: String, id: String, title: String, artist: String },
        { _id: false },
      ),
      default: undefined,
    },
    // map: the place, and the part of the map that's shown.
    place: { type: placeSchema, default: undefined },
    bounds: {
      type: new Schema(
        { south: Number, west: Number, north: Number, east: Number },
        { _id: false },
      ),
      default: undefined,
    },
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

// Someone's answer to one question: which one they tapped - or, on a map
// question, where they put their pin (the last place: it may be moved until
// the time is up) -, how long after the question opened, and what it was
// worth (0: wrong).
const answerSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    questionIdx: { type: Number, required: true },
    answer: { type: Number, default: null },
    lat: { type: Number, default: undefined },
    lng: { type: Number, default: undefined },
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
//   lobby → question → reveal → standings → question → ... → reveal → finished
// (`reveal`: the answer; `standings`: how the game stands, before the next
// question - after the last one comes the end instead)
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
      enum: ['lobby', 'question', 'reveal', 'standings', 'finished', 'abandoned'],
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

export const LIVE_STATUSES = ['lobby', 'question', 'reveal', 'standings'];

export const Quiz = mongoose.model('Quiz', quizSchema);
export const QuizGame = mongoose.model('QuizGame', quizGameSchema);
