import mongoose from 'mongoose';
import { BIRTHDAY_EFFECTS, DEFAULT_BIRTHDAY_MESSAGE } from '../utils/birthday.js';
import { DEFAULT_RANK_MESSAGE } from '../utils/ranks.js';

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
    // Éves jelentés: the year whose report has gone out to the club members
    // (utils/yearlyReportMail.js) - so it's sent once.
    yearlyReportSentYear: Number,
    // Chat photos (see chat/chatImages.js): the folder's size limit (the
    // oldest go first when it's exceeded) and how many one person may send
    // a day.
    chatImages: {
      quotaMB: { type: Number, default: 1024, min: 50, max: 100000 },
      dailyLimit: { type: Number, default: 10, min: 1, max: 1000 },
    },
    // Kép gyorsítótár (see photos/imageSizes.js): the size limit of the
    // smaller photo versions made for the viewer - the least recently
    // viewed go first when it's exceeded.
    imageCache: {
      quotaMB: { type: Number, default: 5120, min: 100, max: 1000000 },
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
    // Fizetési módok (Beállítások): each online gateway on or off, and the
    // fee the payer pays on top - feePercent % of the charge plus feeFixed
    // Ft, at least feeMin Ft (utils/clubSettings.js's paymentFee). Barion
    // is off until its live shop is approved.
    paymentMethods: {
      stripe: {
        enabled: { type: Boolean, default: true },
        feePercent: { type: Number, default: 1.5, min: 0, max: 20 },
        feeFixed: { type: Number, default: 85, min: 0, max: 10000 },
        feeMin: { type: Number, default: 0, min: 0, max: 10000 },
      },
      barion: {
        enabled: { type: Boolean, default: false },
        feePercent: { type: Number, default: 1.6, min: 0, max: 20 },
        feeFixed: { type: Number, default: 0, min: 0, max: 10000 },
        feeMin: { type: Number, default: 0, min: 0, max: 10000 },
      },
    },
    // Születésnap: confetti and a greeting for whoever logs in on their
    // birthday (utils/birthday.js). {név} in the message is their name.
    birthday: {
      enabled: { type: Boolean, default: true },
      effect: { type: String, enum: BIRTHDAY_EFFECTS, default: 'confetti' },
      message: { type: String, default: DEFAULT_BIRTHDAY_MESSAGE, maxlength: 200 },
    },
    // Rangok ünneplése: the first login after reaching a new rank (10, 20,
    // ... tours) - the effect and the message (utils/ranks.js). The admins'
    // e-mail about it goes out even when this is off.
    rankCelebration: {
      enabled: { type: Boolean, default: true },
      effect: { type: String, enum: BIRTHDAY_EFFECTS, default: 'fireworks' },
      message: { type: String, default: DEFAULT_RANK_MESSAGE, maxlength: 200 },
    },
    // Meghívók: the intro of the invitation e-mail (invitationController.js;
    // unset = its DEFAULT_INVITATION_INTRO).
    invitationIntro: { type: String, maxlength: 2000 },
    // Elnök: the club's president - named, with the wax seal, at the end of
    // a tour's beszámoló PDF (tourReportController.js, utils/waxSeal.js).
    presidentName: { type: String, trim: true, maxlength: 100, default: 'Biró Melinda' },
    // OIDC szolgáltató (Beállítások, the role manager only): the Authentik
    // provider people log in through, and the API token invitations are
    // made with - were AUTHENTIK_* in .env (see utils/oidcSettings.js). The
    // two secrets are stored encrypted (utils/secretBox.js) and never go
    // out with the document unless asked for.
    oidc: {
      serverUrl: { type: String, trim: true },
      providerSlug: { type: String, trim: true },
      clientId: { type: String, trim: true },
      clientSecretEnc: { type: String, select: false },
      postLogoutRedirectUri: { type: String, trim: true },
      apiTokenEnc: { type: String, select: false },
      invitationFlow: { type: String, trim: true },
    },
    // Other OIDC providers, added on the same tab next to Authentik (which
    // is `oidc` above and stays for good): any provider that describes
    // itself at its Issuer URL. requireVerifiedEmail: only people whose
    // e-mail address the provider says is confirmed get in - people are
    // matched by their e-mail, so an unconfirmed one could be anybody's.
    oidcProviders: [
      {
        _id: false,
        id: String,
        name: { type: String, trim: true, maxlength: 50 },
        issuerUrl: { type: String, trim: true },
        clientId: { type: String, trim: true },
        clientSecretEnc: { type: String, select: false },
        postLogoutRedirectUri: { type: String, trim: true },
        requireVerifiedEmail: { type: Boolean, default: true },
      },
    ],
    // Which one everybody logs in through: 'authentik' (also when unset),
    // or the id of one of oidcProviders.
    oidcActiveProvider: String,
    history: [{ _id: false, at: Date, byName: String, change: String }],
  },
  { timestamps: true },
);

const ClubSettings = mongoose.model('ClubSettings', clubSettingsSchema);

export default ClubSettings;
