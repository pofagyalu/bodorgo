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
  // Whether THIS specific person has paid their own advance for this
  // tour. The real source of truth for display now - Reservation.paid
  // below used to be read for this (see computeAttendeePayments), but it
  // only ever tracked the whole reservation, incorrectly showing every
  // family member sharing one as paid/unpaid together even though
  // different family members can genuinely pay at different times
  // (especially with the self-service "Előleg befizetés" flow). Existing
  // reservations were backfilled from their own Reservation.paid value
  // (see scripts/migrateAttendeePaidField.js) - new ones default to false.
  paid: {
    type: Boolean,
    default: false,
  },
  // Admin-only, set via updateAttendeeFeeExempt - a real but rare case
  // where this specific person owes nothing at all for the
  // accommodation, regardless of the tour's own pricing formula: an
  // infant, a last-minute guest who joins for free because the whole
  // house is already paid for, an invited guest the club is comping.
  // Distinct from the tour's own age-based child discount
  // (tourModel.js's childPricePerNight/childAgeLimitYears), which is a
  // formula applied to everyone equally, not a case-by-case override.
  // They're still a normal attendee otherwise - counted toward capacity,
  // occupying nights, appearing in the schedule - just excluded from
  // what's actually owed (see computeAttendeePayments).
  feeExempt: {
    type: Boolean,
    default: false,
  },
  // Szobabeosztás: which room of the tour's accommodation this person
  // sleeps in - the _id of a room inside tour.accommodation.houses[].rooms
  // (see tourModel.js). Absent = no room yet. Lives here, on the
  // registration itself, so cancelling a registration frees the place
  // automatically; a deleted room's people are cleared back to "no room"
  // by accommodationController.js.
  room: {
    type: Schema.Types.ObjectId,
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
      required: [true, 'Minden foglalásnak kell legyen egy foglaló felhasználója!'],
    },
    attendees: [attendeeSchema],
    totalPrice: {
      type: Number,
      required: false,
    },
    // No longer read anywhere for display - see attendeeSchema's own
    // paid field above for the real, per-person source of truth. Kept
    // around as the original whole-booking intent (e.g. still set by
    // scripts/create-reservation.js and importAttendance.js when
    // entering historical data by hand), not actively used by the app.
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
