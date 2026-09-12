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
