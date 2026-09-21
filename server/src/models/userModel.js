import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import validator from 'validator';
import crypto from 'crypto';

const { Schema } = mongoose;

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
    // actively turned it off. Also gates the admin's "email every attendee
    // the Programfüzet" bulk-send (see reservationController-adjacent logic
    // in tourPdfController.js's emailTourPdfToAttendees), alongside having
    // an email address at all and having logged in at least once.
    wantsEmailNotifications: {
      type: Boolean,
      default: true,
    },
    photo: {
      type: String,
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
    // Role is driven entirely by Authentik on every login (see
    // authOidcController.js's callback()) via a custom `bodorgo_role` scope
    // claim that Authentik itself computes from the user's group membership
    // - this app no longer maps group names to a role by hand. A login
    // always sends a valid role or is denied outright, so 'member'/'admin'
    // only ever land here via a real login.
    // 'member' is an official, dues-paying club member.
    // The 'guest' default only ever applies to a login-less dependent
    // (e.g. a child, see addFamilyMember.js/importAttendance.js) who has
    // never logged in and so never went through the claim above.
    role: {
      type: String,
      enum: ['admin', 'member', 'guest'],
      default: 'guest',
    },
    passwordResetToken: String,
    passwordResetExpires: Date,
    active: {
      type: Boolean,
      default: true,
      select: false,
    },
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
  },
  { timestamps: true },
);

userSchema.pre('save', async function (next) {
  if (this.isModified('password') && this.password) {
    this.password = await bcrypt.hash(this.password, 12);
    this.passwordConfirm = undefined;
  }

  next();
});

userSchema.pre('save', function (next) {
  if (this.isModified('password') && !this.isNew) {
    //  Guarantee that passwordChangedAt is before jwt token iat
    this.passwordChangedAt = new Date(Date.now() - 1000);
  }

  next();
});

userSchema.pre(/^find/, function (next) {
  this.find({ active: { $ne: false } });
  next();
});

userSchema.methods.correctPassword = async function (
  candidatePassword,
  userPassword,
) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(
      this.passwordChangedAt.getTime() / 1000,
      10,
    );
    return JWTTimestamp < changedTimestamp;
  }

  return false;
};

userSchema.methods.createPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');

  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  this.passwordResetExpires = Date.now() + 600000; // 10 minutes in ms

  return resetToken;
};

const User = mongoose.model('User', userSchema);

export default User;
