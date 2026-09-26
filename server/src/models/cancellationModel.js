import mongoose from 'mongoose';

const { Schema } = mongoose;

// One withdrawn tour registration ("Lemondás") - who was taken off which
// tour, when, by whom and why. Kept apart from the reservations (which
// just lose the attendee, or disappear when it was the last one), so the
// admins' "Lemondások" list survives either way (see
// reservationController.js's withdrawAttendee).
const cancellationSchema = new Schema({
  tour: { type: Schema.Types.ObjectId, ref: 'Tour', required: true, index: true },
  user: { type: Schema.Types.ObjectId, ref: 'User' },
  name: { type: String, required: true },
  bookedByName: String,
  cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
  cancelledByName: String,
  reason: { type: String, trim: true, default: '' },
  // They had already paid their advance - nothing is refunded
  // automatically, the club settles it in-house; this just flags it.
  wasPaid: { type: Boolean, default: false },
  cancelledAt: { type: Date, default: Date.now },
});

const Cancellation = mongoose.model('Cancellation', cancellationSchema);

export default Cancellation;
