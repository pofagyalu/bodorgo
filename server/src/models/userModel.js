import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import validator from 'validator';
import crypto from 'crypto';
import { geocodeAddress } from '../utils/distance.js';
import logger from '../logger.js';
import { USERNAME_RULE, USERNAME_RULE_MESSAGE } from '../utils/usernames.js';

const { Schema } = mongoose;

const invitationSchema = new mongoose.Schema(
  { id: String, sentAt: Date, expiresAt: Date, sentByName: String },
  { _id: false },
);

const userSchema = new Schema(
  {
    // Absent for a dependent (e.g. a child) who has no Authentik account of
    // their own and can never log in - they exist purely as an attendee
    // record shared with their family. See familyId below.
    sub: { type: String, sparse: true, unique: true, required: false },
    name: {
      type: String,
      required: [true, 'Névtelenül, mi???'],
    },
    firstName: {
      type: String,
      // required: [true, 'Hiányzik a családnév'],
    },
    lastName: {
      type: String,
      // required: [true, 'Hiányzik a keresztnév'],
    },
    email: {
      type: String,
      lowercase: true,
      sparse: true,
      unique: true,
      required: false,
      validate: {
        validator: function (email) {
          if (!email) return true;
          return validator.isEmail(email);
        },
        message: 'Please provide a valid email',
      },
    },
    emailVerified: {
      type: Boolean,
      default: false,
      select: false,
    },
    // A personal handle distinct from `name` above (which comes from
    // Authentik and nobody edits directly in this app) - shown in the tour
    // chat, and what "@username" mentions there refer to. The user sets
    // their own (see userController.js's updateMe); an admin may too, e.g.
    // filling everyone in at first (updateUser / updateUsernames). Unique
    // regardless of upper/lower case and accents (see utils/usernames.js).
    username: {
      type: String,
      trim: true,
      sparse: true,
      unique: true,
      match: [USERNAME_RULE, USERNAME_RULE_MESSAGE],
    },
    // Neither is shown directly (birthday especially never renders in the
    // admin table - see userController.js's computeAge) - birthday only
    // exists to derive a displayed age, and to pre-fill the edit form.
    birthday: {
      type: Date,
    },
    gender: {
      type: String,
      enum: ['férfi', 'nő'],
    },
    // Set on every successful Authentik login (see authOidcController.js) -
    // absent entirely for a login-less dependent who's never actually
    // logged in themselves yet.
    lastLoginAt: {
      type: Date,
    },
    // Self-service opt-out (see profile's toggle) - defaults to true ("yes,
    // send me email notifications") so this only matters for someone who's
    // actively turned it off. Also gates the admin's letters to a tour's
    // attendees (see mailingController.js, via tourPdfController.js's
    // partitionAttendeesByEmailEligibility), alongside having
    // an email address at all and having logged in at least once.
    wantsEmailNotifications: {
      type: Boolean,
      default: true,
    },
    // Profile photo - the image itself lives in its own collection (see
    // userPhotoModel.js); this is just when it last changed, doubling as
    // the client's cache-busting version (?v=...) and as "has a photo".
    photoUpdatedAt: {
      type: Date,
    },
    // Who last set (or removed) the photo. Once the user has done it
    // themselves ('self'), an admin can no longer change or remove it -
    // see userPhotoController.js's loadTargetForAdmin.
    photoSetBy: {
      type: String,
      enum: ['admin', 'self'],
    },
    password: {
      type: String,
      // required: [true, 'Please provide a password'],
      minLength: 8, //Később tedd át 12-re
      select: false,
    },
    passwordConfirm: {
      type: String,
      // required: [true, 'Please confirm your password'],
      validate: {
        // This only works on SAVE!!!
        validator: function (el) {
          return this.password === el;
        },
        message: 'Passwords are not the same',
      },
    },
    passwordChangedAt: Date,
    // Managed in the app only (Authentik just says who someone is): only
    // the role manager may change it (canManageRoles below, see
    // utils/roleManager.js). 'member' is an official, dues-paying club
    // member; 'guest' - the default - anyone else: a family member, a child
    // who never logs in.
    role: {
      type: String,
      enum: ['admin', 'member', 'guest'],
      default: 'guest',
    },
    // The one admin who may change roles - whoever INITIAL_ADMIN_USER in the
    // server's .env names; set (and taken from everyone else) at every server
    // start. Never set through the API.
    canManageRoles: { type: Boolean, default: false },
    // The calendar year this person officially became a dues-paying club
    // member - not tracked anywhere else (Authentik only knows the current
    // role, not history), so an admin sets it by hand (see
    // userController.js's updateUser/profile.html's admin table). Drives
    // the Klub "Felhasználók" page's per-year membership table: a year
    // before this one shows as "not a member yet" rather than unpaid.
    // Undefined until an admin sets it.
    memberSince: {
      type: Number,
    },
    passwordResetToken: String,
    passwordResetExpires: Date,
    // Admin-set only, via the Klub "Felhasználók" page's archive/restore
    // button (see userController.js's archiveUser/restoreUser) - the app's
    // "delete": someone who attended a few tours and then stopped, kept for
    // history (member lists, stats, past attendance, payments) exactly like
    // anyone else, never actually removed. The ONE place this actually
    // changes anything is that an admin building a new reservation or a
    // schedule-event opt-in list won't see them offered as a candidate any
    // more. Overrides the login-based Aktív/Inaktív status shown on that
    // page (see members.ts's userStatus) - a later login doesn't undo it.
    retired: {
      type: Boolean,
      default: false,
    },
    retiredAt: {
      type: Date,
    },
    // The year their birthday was last celebrated (confetti on login - see
    // utils/birthday.js): once a year, on whichever device comes first.
    birthdayCelebratedYear: Number,
    // The highest rank already celebrated (its tour count: 10, 20, ...; 0
    // none) - see utils/ranks.js. Unset until their first check, which
    // starts it at the rank they had when the celebrations began.
    rankCelebrated: Number,
    // Their latest Authentik invitation (Felhasználók → Meghívók - see
    // invitationController.js): its id there, when it was sent and by whom,
    // and when the link expires. Cleared when it's taken back.
    invitation: invitationSchema,
    // Groups a real account together with the login-less dependents (and
    // any other real accounts, e.g. a spouse) it shares tour attendance
    // with - lets a logged-in parent's signup dropdown be scoped to
    // "everyone with this familyId" instead of a free-text/global search.
    // Assigned by hand for now (see server/scripts/createFamily.js and
    // addFamilyMember.js), not through any self-service flow.
    familyId: {
      type: Schema.Types.ObjectId,
      index: true,
    },
    // Self-service (profile) or admin-set - structured rather than one
    // free-text field specifically so `city` can be used on its own for
    // the "X-tól/-től" ("from X") wording on the tour page/PDF (see
    // hungarianGrammar.js) without having to guess which part of a
    // comma-separated string is the city. country defaults to Hungary
    // since most members are, but a friend elsewhere (e.g. Romania) can
    // just fill it in - see the pre('save') hook below, which geocodes
    // the combined address into `location` whenever it changes.
    address: {
      zipCode: { type: String, trim: true },
      city: { type: String, trim: true },
      street: { type: String, trim: true },
      country: { type: String, trim: true, default: 'Magyarország' },
    },
    // Geocoded from `address` above (see pre('save') below) - undefined
    // until a real address with at least a city has been saved and
    // successfully resolved. Once set, lets a tour's distance/duration be
    // computed from the viewer's own home instead of the fixed Budapest
    // reference point (see tourController.js's getTour).
    location: {
      lat: { type: Number },
      lng: { type: Number },
    },
  },
  { timestamps: true },
);

userSchema.pre('save', async function () {
  if (this.isModified('password') && this.password) {
    this.password = await bcrypt.hash(this.password, 12);
    this.passwordConfirm = undefined;
  }
});

userSchema.pre('save', function () {
  if (this.isModified('password') && !this.isNew) {
    //  Guarantee that passwordChangedAt is before jwt token iat
    this.passwordChangedAt = new Date(Date.now() - 1000);
  }
});

// Re-geocodes whenever the address actually changes (not on every save) -
// a failed/unresolvable address just leaves `location` unset rather than
// blocking the profile save, same resilience as tourModel.js's own
// distance pre('save') hook.
userSchema.pre('save', async function () {
  if (!this.isModified('address')) {
    return;
  }

  const { zipCode, city, street, country } = this.address || {};
  if (!city) {
    // No city at all means no meaningful address to geocode - and if one
    // existed before, it just got cleared, so any stale location has to
    // go with it. `location` is a plain nested path, not a real
    // subdocument - assigning `undefined` to the whole group doesn't
    // reliably unset both leaves in Mongoose, so each is cleared
    // explicitly instead.
    this.set('location.lat', undefined);
    this.set('location.lng', undefined);
    return;
  }

  try {
    const text = [zipCode, city, street, country || 'Magyarország'].filter(Boolean).join(', ');
    this.location = await geocodeAddress(text);
  } catch (err) {
    logger.error(`Failed to geocode address for user ${this._id}: ${err.message}`);
  }
});

userSchema.methods.correctPassword = async function (candidatePassword, userPassword) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return JWTTimestamp < changedTimestamp;
  }

  return false;
};

userSchema.methods.createPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');

  this.passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');

  this.passwordResetExpires = Date.now() + 600000; // 10 minutes in ms

  return resetToken;
};

const User = mongoose.model('User', userSchema);

export default User;
