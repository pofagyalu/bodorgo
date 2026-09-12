import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import validator from 'validator';
import crypto from 'crypto';

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    sub: { type: String, unique: true, required: true },
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
    role: {
      type: String,
      enum: ['bodorgo', 'admin', 'guest'],
      default: 'bodorgo',
    },
    passwordResetToken: String,
    passwordResetExpires: Date,
    active: {
      type: Boolean,
      default: true,
      select: false,
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
