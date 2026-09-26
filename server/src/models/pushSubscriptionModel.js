import mongoose from 'mongoose';

const { Schema } = mongoose;

// One device (browser) a user turned notifications on for - the address
// the browser's push service gave it (see utils/push.js). Removed when the
// user turns them off there, or when the push service says it's gone.
const pushSubscriptionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    userAgent: String,
  },
  { timestamps: true },
);

const PushSubscription = mongoose.model('PushSubscription', pushSubscriptionSchema);

export default PushSubscription;
