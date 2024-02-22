import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

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
    minlength: 10,
  },
  secretResetToken: String,
  secretResetExpires: Date,
  user: { type: ObjectId, ref: 'User' },
});

authMethodSchema.pre('save', async function (next) {
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

  this.secretResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  this.secretResetExpires = Date.now() + 10 * 60 * 1000;

  return resetToken;
};

const AuthMethod = mongoose.model('AuthMethod', authMethodSchema);

export default AuthMethod;
