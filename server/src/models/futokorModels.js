import mongoose from 'mongoose';
import { DEFAULTS } from '../futokor/runRules.js';

const { Schema } = mongoose;

// Futókör (the checkpoint running race) - what it stores. The rules of a
// run are in futokor/runRules.js; how these fit together, in
// controllers/futokorController.js.

// A card: printed once (a QR code, later an NFC sticker on its back),
// laminated, and used again on every tour. It says nothing about any
// course - which checkpoint it is today is the course's business.
const tagSchema = new Schema(
  {
    // What the card is called and what its link carries: "T01", "T02"...
    tagId: { type: String, required: true, unique: true },
    // The START/FINISH card looks different (and there's usually one).
    kind: { type: String, enum: ['startFinish', 'checkpoint'], default: 'checkpoint' },
    // Lost or damaged: its link no longer counts.
    retired: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const FutokorTag = mongoose.model('FutokorTag', tagSchema);

// A course: a tour's loop - one per tour. Runs count while it's open
// (opensAt-closesAt); no two courses are open at the same time, so a card
// scanned at any moment belongs to at most one.
const courseSchema = new Schema(
  {
    tour: { type: Schema.Types.ObjectId, ref: 'Tour', required: true, unique: true },
    name: { type: String, required: true, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    opensAt: { type: Date, required: true },
    closesAt: { type: Date, required: true },
    maxRunDurationMin: { type: Number, default: DEFAULTS.maxRunDurationMin },
    flagSpeedMps: { type: Number, default: DEFAULTS.flagSpeedMps },
    duplicateScanWindowSec: { type: Number, default: DEFAULTS.duplicateScanWindowSec },
    // The whole loop in metres - null until it's measured (then there are
    // times, but no pace and no speed check).
    distanceM: { type: Number, default: null },
    // The START/FINISH card first (order 0), then the checkpoints in the
    // order they're passed (1, 2, 3...).
    checkpoints: {
      type: [
        {
          _id: false,
          tagId: { type: String, required: true },
          kind: { type: String, enum: ['startFinish', 'checkpoint'], required: true },
          label: { type: String, required: true },
          order: { type: Number, required: true },
          // How far along the loop it is, in metres.
          distanceAlongM: { type: Number, default: null },
          lat: { type: Number, default: null },
          lng: { type: Number, default: null },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

export const FutokorCourse = mongoose.model('FutokorCourse', courseSchema);

// A scan as the phone sent it - kept as it is. A runner's runs are worked
// out from these (runRules.js's replayScans) every time new ones arrive,
// which may be much later than they were made (no signal in the garden).
const scanSchema = new Schema({
  // Made up by the phone: sending the same scan again changes nothing.
  clientScanId: { type: String, required: true, unique: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  course: { type: Schema.Types.ObjectId, ref: 'FutokorCourse', required: true },
  // Null for giving up (no card is scanned for that).
  tagId: { type: String, default: null },
  action: { type: String, enum: ['restart', 'giveUp', null], default: null },
  // The phone's clock: what the run is timed by.
  deviceTime: { type: Date, required: true },
  serverTime: { type: Date, default: Date.now },
  lat: { type: Number, default: null },
  lng: { type: Number, default: null },
  accuracyM: { type: Number, default: null },
});

scanSchema.index({ user: 1, course: 1 });

export const FutokorScan = mongoose.model('FutokorScan', scanSchema);

// A run, as the rules see it from the scans: replaced whenever its
// runner's scans are replayed.
const runSchema = new Schema({
  course: { type: Schema.Types.ObjectId, ref: 'FutokorCourse', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  status: {
    type: String,
    enum: ['running', 'finished', 'gave_up', 'abandoned', 'expired'],
    required: true,
  },
  startedAt: { type: Date, required: true },
  finishedAt: { type: Date, default: null },
  // How many checkpoints it passed.
  passed: { type: Number, default: 0 },
  splits: {
    type: [
      {
        _id: false,
        fromCheckpointId: String,
        toCheckpointId: String,
        ms: Number,
        distanceM: Number,
        speedMps: Number,
        paceSecPerKm: Number,
      },
    ],
    default: [],
  },
  totalMs: { type: Number, default: null },
  paceSecPerKm: { type: Number, default: null },
  // Something for an admin to look at: a suspicious speed, a scan made far
  // from its card.
  flagged: { type: Boolean, default: false },
});

runSchema.index({ course: 1, user: 1 });

export const FutokorRun = mongoose.model('FutokorRun', runSchema);
