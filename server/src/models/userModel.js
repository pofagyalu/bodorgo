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
    // Set on every successful Authentik login (see authOidcController.js) -
    // absent entirely for a login-less dependent who's never actually
    // logged in themselves yet.
    lastLoginAt: {
      type: Date,
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
    // 'bodorgo' is an official, dues-paying club member - granted by an
    // admin by hand once membership is actually paid, never automatically
    // (not on signup, not on first login). Everyone starts, and stays,
    // 'guest' until then - that covers both a login-less dependent (e.g. a
    // child) and an adult with a real account who simply hasn't paid dues
    // yet. See docs/memory on bodorgo role semantics for the full picture.
    role: {
      type: String,
      enum: ['bodorgo', 'admin', 'guest'],
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
