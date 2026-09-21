import mongoose from 'mongoose';

const { Schema } = mongoose;

// attendeeSchema supports real and minimal users
const attendeeSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true, // every attendee MUST reference a User now
  },
  name: {
    type: String,
    required: true,
  },
  // How many nights of the tour this specific person is being billed for -
  // set to the tour's own (duration - 1) at signup time (see
  // reservationController.js's signUpForTour), and only ever changed
  // afterward by an admin, for the rare case someone leaves a night early.
  // Older attendees created before this field existed simply don't have
  // it - computeAttendeePayments falls back to the same (duration - 1)
  // default for them, so no backfill migration was needed.
  nights: {
    type: Number,
    min: [0, 'Az éjszakák száma nem lehet negatív'],
  },
});

const reservationSchema = new Schema(
  {
    tour: {
      type: Schema.Types.ObjectId,
      ref: 'Tour',
      required: [true, 'Minden foglalásnak tartoznia kell egy táborhoz!'],
    },
    bookedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [
        true,
        'Minden foglalásnak kell legyen egy foglaló felhasználója!',
      ],
    },
    attendees: [attendeeSchema],
    totalPrice: {
      type: Number,
      required: false,
    },
    paid: {
      type: Boolean,
      default: false,
    },
    paymentId: String, // if you use Stripe or smth later
  },
  {
    timestamps: true,
  },
);

// Automatically calculate total attendees of one reservation
reservationSchema.virtual('numAttendees').get(function () {
  return this.attendees.length;
});

const Reservation = mongoose.model('Reservation', reservationSchema);

export default Reservation;
