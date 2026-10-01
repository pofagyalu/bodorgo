import mongoose from 'mongoose';
import { OUT_MODES, PLAY_UNTIL, START_SCORES } from '../jatekok/darts/x01.js';

const { Schema } = mongoose;

// The kinds of game: X01 (301 / 201 / 101, see jatekok/darts/x01.js) and
// Cricket (cricket.js).
export const GAME_TYPES = ['x01', 'cricket'];

// A dart: see jatekok/darts/x01.js for what's valid.
const throwSchema = new Schema(
  {
    segment: { type: Number, required: true },
    multiplier: { type: Number, required: true },
  },
  { _id: false },
);

// A player: a user of the app, or someone just named for this game.
const playerSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    guestName: { type: String, trim: true, default: null },
  },
  { _id: false },
);

// One turn at the board: up to three darts. Only the darts are stored -
// the points, busts and whose round it was are worked out from them every
// time (jatekok/darts/x01.js's replay).
const turnSchema = new Schema(
  {
    // The player's place in `players`.
    playerIdx: { type: Number, required: true },
    throws: { type: [throwSchema], default: [] },
    enteredBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // Set when the turn was corrected afterwards: who, when, and what it
    // was before (the last time).
    editedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    editedAt: { type: Date, default: null },
    previousThrows: { type: [throwSchema], default: undefined },
  },
  { _id: false },
);

// Móka → Darts: one game. It starts the moment it's created (the players
// and the options are chosen on the phone before that) and is `finished`
// once the rules say it's over, or the players end it - a correction or
// an undo can take that back.
// An abandoned game stays in the list, but nothing more is thrown in it.
const dartsGameSchema = new Schema(
  {
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: GAME_TYPES, default: 'x01' },
    // X01's options (Cricket has none).
    options: {
      startScore: { type: Number, enum: START_SCORES, default: 301 },
      outMode: { type: String, enum: OUT_MODES, default: 'single' },
      playUntil: { type: String, enum: PLAY_UNTIL, default: 'all' },
    },
    // In throwing order.
    players: { type: [playerSchema], required: true },
    status: {
      type: String,
      enum: ['in_progress', 'finished', 'abandoned'],
      default: 'in_progress',
    },
    turns: { type: [turnSchema], default: [] },
    // The players ended it themselves ("Játék befejezése") before the rules
    // did: it's finished as it stood. Undo takes it back.
    ended: { type: Boolean, default: false },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

dartsGameSchema.index({ createdAt: -1 });

const DartsGame = mongoose.model('DartsGame', dartsGameSchema);

export default DartsGame;
