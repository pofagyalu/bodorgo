import mongoose from 'mongoose';

const { Schema } = mongoose;

// Club-wide settings an admin can change on the Klub → Beállítások page -
// a single document (key: 'club'), see utils/clubSettings.js.
const clubSettingsSchema = new Schema(
  {
    key: { type: String, default: 'club', unique: true },
    // The yearly membership fee, by the year it takes effect: the fee for
    // a year is the latest row whose fromYear has started by then - so a
    // raise from 2027 leaves older, still unpaid years at their old rate.
    membershipFees: [{ _id: false, fromYear: Number, amount: Number }],
    // Who changed what, when - shown on the settings page.
    history: [{ _id: false, at: Date, byName: String, change: String }],
  },
  { timestamps: true },
);

const ClubSettings = mongoose.model('ClubSettings', clubSettingsSchema);

export default ClubSettings;
