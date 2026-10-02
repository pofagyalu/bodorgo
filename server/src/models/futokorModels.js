import mongoose from 'mongoose';
import { DEFAULTS } from '../futokor/runRules.js';

const { Schema } = mongoose;

// Futókör (the checkpoint running race) - what it stores. The rules of a
// run are in futokor/runRules.js; how these fit together, in
// controllers/futokorController.js.

// A card: printed once (a QR code, later an NFC sticker on its back) and
// laminated. Two kinds:
// - the club's own set (S1, T01, T02...), made by the admins and used
//   again on every tour - which checkpoint a card is today is the tour's
//   course's business;
// - a user's own track's cards (P3-S, P3-01...), made with the track and
//   belonging only to it (`course`).
const tagSchema = new Schema(
  {
    // What the card is called and what its link carries: "T01", "T02"...
    tagId: { type: String, required: true, unique: true },
    // The START/FINISH card looks different (and there's usually one).
    kind: { type: String, enum: ['startFinish', 'checkpoint'], default: 'checkpoint' },
    // Lost or damaged: its link no longer counts.
    retired: { type: Boolean, default: false },
    // The user's own track it was made for - null: one of the club's set.
    course: { type: Schema.Types.ObjectId, ref: 'FutokorCourse', default: null },
  },
  { timestamps: true },
);

export const FutokorTag = mongoose.model('FutokorTag', tagSchema);

// A course: a loop to run. Runs count while it's open (opensAt-closesAt).
// Two kinds:
// - a tour's course (`tour`): one per tour, the admins', with the club's
//   cards; no two of them are open at the same time;
// - a user's own track (no `tour`): anyone can make one and is its owner
//   (`createdBy`), it has its own cards, and it can be open whenever -
//   alongside a tour's course or other tracks. Which course a run is on is
//   decided by the START card that was scanned.
const courseSchema = new Schema(
  {
    // (Not set at all on a user's own track - the index only holds tours.)
    tour: { type: Schema.Types.ObjectId, ref: 'Tour' },
    name: { type: String, required: true, trim: true },
    // Whoever made it: a user's own track is theirs to change.
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // The GPX file its loop is from (gpxTrackModel.js) - null if none.
    gpx: { type: Schema.Types.ObjectId, ref: 'GpxTrack', default: null },
    opensAt: { type: Date, required: true },
    closesAt: { type: Date, required: true },
    maxRunDurationMin: { type: Number, default: DEFAULTS.maxRunDurationMin },
    flagSpeedMps: { type: Number, default: DEFAULTS.flagSpeedMps },
    duplicateScanWindowSec: { type: Number, default: DEFAULTS.duplicateScanWindowSec },
    // The whole loop in metres - null until it's measured (then there are
    // times, but no pace and no speed check).
    distanceM: { type: Number, default: null },
    // The loop itself, to draw on the map: [lat, lng] pairs, from a GPX
    // file (see futokor/gpx.js) - empty until one is attached.
    track: { type: [[Number]], default: [] },
    // What the loop climbs, from the same file.
    elevationGainM: { type: Number, default: null },
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

// One course per tour - a user's own tracks (no tour) aren't in the index.
courseSchema.index({ tour: 1 }, { unique: true, sparse: true });

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

// Where a runner is right now - only while they run, and only if they
// chose to be seen ("Élő követés"). One per runner and course: each new
// position takes the place of the last, so no trail is ever kept; it goes
// when the run is over, and by itself soon after the phone stops sending.
const positionSchema = new Schema({
  course: { type: Schema.Types.ObjectId, ref: 'FutokorCourse', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  accuracyM: { type: Number, default: null },
  // When the server got it.
  at: { type: Date, default: Date.now },
});

positionSchema.index({ course: 1, user: 1 }, { unique: true });
// Mongo removes it two minutes after the last one arrived.
positionSchema.index({ at: 1 }, { expireAfterSeconds: 120 });

export const FutokorPosition = mongoose.model('FutokorPosition', positionSchema);
