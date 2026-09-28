import mongoose from 'mongoose';
import { BIRTHDAY_EFFECTS, DEFAULT_BIRTHDAY_MESSAGE } from '../utils/birthday.js';

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
    // "Tagdíj emlékeztető": e-mails to members who haven't paid this
    // year's fee yet (see utils/membershipReminders.js). The rounds of a
    // year start on startMonth/startDay and repeat monthly or quarterly
    // until the year's end; lastRoundSent ("YYYY-MM-DD") is the latest
    // round already sent, so each goes out once.
    membershipReminder: {
      enabled: { type: Boolean, default: false },
      startMonth: { type: Number, default: 3, min: 1, max: 12 },
      startDay: { type: Number, default: 1, min: 1, max: 28 },
      frequency: { type: String, enum: ['monthly', 'quarterly'], default: 'quarterly' },
      lastRoundSent: String,
    },
    // The year whose "Minden klubtag befizette a tagdíjat" e-mail has gone
    // to the admins - so it's sent once a year (see
    // utils/membershipReminders.js's notifyAdminsIfAllMembersPaid).
    allPaidNotifiedYear: Number,
    // Chat photos (see chat/chatImages.js): the folder's size limit (the
    // oldest go first when it's exceeded) and how many one person may send
    // a day.
    chatImages: {
      quotaMB: { type: Number, default: 1024, min: 50, max: 100000 },
      dailyLimit: { type: Number, default: 10, min: 1, max: 1000 },
    },
    // Who changed what, when - shown on the settings page.
    // The two Barion wallets (Beállítások; were BARION_MEMBERSHIP_*/
    // BARION_TOUR_* in .env): payeeEmail - where each purpose's payments
    // land; withdrawName/withdrawIban - the bank account a withdrawal goes
    // to. Only admins change them, and every change is e-mailed to all
    // admins (settingsController.js's updateBarionWallet). The wallets' API
    // keys are secrets and stay in .env (config.barion.walletKeys).
    barion: {
      membership: {
        payeeEmail: String,
        withdrawName: String,
        withdrawIban: String,
      },
      tour: { payeeEmail: String, withdrawName: String, withdrawIban: String },
    },
    // Születésnap: confetti and a greeting for whoever logs in on their
    // birthday (utils/birthday.js). {név} in the message is their name.
    birthday: {
      enabled: { type: Boolean, default: true },
      effect: { type: String, enum: BIRTHDAY_EFFECTS, default: 'confetti' },
      message: { type: String, default: DEFAULT_BIRTHDAY_MESSAGE, maxlength: 200 },
    },
    history: [{ _id: false, at: Date, byName: String, change: String }],
  },
  { timestamps: true },
);

const ClubSettings = mongoose.model('ClubSettings', clubSettingsSchema);

export default ClubSettings;
