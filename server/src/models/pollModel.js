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
    // Every poll belongs to exactly one tour - there's no "general" poll in
    // this app's model, by the admin's own design.
    tour: {
      type: Schema.Types.ObjectId,
      ref: 'Tour',
      required: [true, 'A szavazásnak kell legyen tábora.'],
    },
    question: {
      type: String,
      required: [true, 'A szavazásnak kell legyen kérdése.'],
      trim: true,
    },
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
