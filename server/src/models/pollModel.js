import mongoose from 'mongoose';

const { Schema } = mongoose;

const optionSchema = new Schema({
  text: { type: String, required: true, trim: true },
});

// Deliberately minimal - just enough to enforce "one vote per user" and
// tally counts server-side (see pollController.js's buildPollView). Never
// select:false's sibling data (which user picked which option) leaves this
// model directly - results sent to the client are always aggregate counts
// only, nobody (not even admin) can see who voted for what.
const voteSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    option: { type: Schema.Types.ObjectId, required: true },
    votedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const pollSchema = new Schema(
  {
    // The tour it's about - or none: a general poll, for everyone (started
    // from the general Kotyogó, or on Voks without a tour).
    tour: {
      type: Schema.Types.ObjectId,
      ref: 'Tour',
      default: null,
    },
    question: {
      type: String,
      required: [true, 'A szavazásnak kell legyen kérdése.'],
      trim: true,
    },
    // "Részletek" - optional formatted text under the question (links,
    // lists...), cleaned like a mailing (see pollController.js).
    details: { type: String, default: '' },
    options: {
      type: [optionSchema],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length >= 2,
        message: 'Legalább 2 válaszlehetőség szükséges.',
      },
    },
    // Voting closes automatically once this passes (see
    // pollController.js's buildPollView) - not a background job, just
    // compared against "now" on every read/vote.
    closesAt: {
      type: Date,
      required: [true, 'A szavazásnak kell legyen záró időpontja.'],
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // select:false - never loaded by a plain find() (see getAllPolls/
    // getPoll explicitly opting back in with +votes) so it's never
    // accidentally sent to the client as-is. Only ever leaves this model
    // through buildPollView's aggregate counts.
    // 'open' (Nyílt): everyone sees who voted for what, all the time -
    // for "who's coming?". 'secret' (Titkos): only counts, and only once
    // you voted or it closed - for "where do we eat?".
    visibility: { type: String, enum: ['open', 'secret'], default: 'secret' },
    // Optional "at least N on this answer" - e.g. the museum only opens
    // for 5. minimumReachedAt: when it got there (told once).
    minimum: {
      option: { type: Schema.Types.ObjectId },
      count: { type: Number, min: 1 },
    },
    minimumReachedAt: { type: Date, default: null },
    // The chat message it was started from, if it was (see
    // pollController.js's createTourPoll).
    post: { type: Schema.Types.ObjectId, ref: 'Post', default: null },
    // The "closes in 2 hours" reminder went out (see pollReminders.js).
    reminderSentAt: { type: Date, default: null },
    votes: {
      type: [voteSchema],
      default: [],
      select: false,
    },
  },
  { timestamps: true },
);

const Poll = mongoose.model('Poll', pollSchema);

export default Poll;
