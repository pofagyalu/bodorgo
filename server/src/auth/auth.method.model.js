import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

const { Schema } = mongoose;
const { ObjectId } = Schema;
const SALT_ROUNDS = 12;

const authMethodSchema = Schema({
  type: {
    type: String,
    enum: ['PASSWORD', 'FACEBOOK_OAUTH', 'GOOGLE_OAUTH'],
  },
  secret: {
    type: String,
    required: [true, `Please provide your password`],
    minlength: 6,
  },
  passwordResetToken: String,
  passwordResetExpires: Date,
  verificationToken: String,
  user: { type: ObjectId, ref: 'User' },
});

authMethodSchema.pre('save', async function (next) {
  if (!this.isModified('secret')) return next();

  this.secret = await bcrypt.hash(this.secret, SALT_ROUNDS);

  next();
});

authMethodSchema.methods.correctPassword = async function (
  candidatePassword,
  userPassword,
) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

authMethodSchema.methods.createPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');

  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  this.passwordResetExpires = Date.now() + 10 * 60 * 1000;

  return resetToken;
};

authMethodSchema.methods.createVerificationToken = function () {
  const token = crypto.randomBytes(32).toString('hex');

  this.verificationToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  return token;
};

const AuthMethod = mongoose.model('AuthMethod', authMethodSchema);

export default AuthMethod;
