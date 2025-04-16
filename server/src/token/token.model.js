import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const { ObjectId } = Schema;

const tokenSchema = new Schema(
  {
    refreshToken: { type: String, required: true },
    ip: { type: String, required: true },
    userAgent: { type: String, required: true },
    isValid: { type: Boolean, default: true },
    user: { type: ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

const Token = model('Token', tokenSchema);

export default Token;
