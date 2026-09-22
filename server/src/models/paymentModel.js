import mongoose from 'mongoose';

const { Schema } = mongoose;

// One attempt at paying something via Stripe Checkout (see
// utils/stripe.js/controllers/paymentController.js). This app has (at
// least) two different things a payment can be for - a tour's advance
// (implemented now) and a club member's yearly membership fee (a real,
// planned second use of this same model, not yet built) - purpose says
// which, and only the fields relevant to that purpose are ever set.
// Deliberately one shared collection rather than two separate ones: both
// kinds go through the identical Stripe start/webhook/status machinery,
// and a member's own payment history naturally wants to show both kinds
// together later.
const paymentSchema = new Schema(
  {
    purpose: {
      type: String,
      enum: ['tourAdvance', 'membershipFee'],
      required: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // stripe: the normal self-service Checkout flow. cash: an admin
    // recording money they were handed in person (see
    // paymentController.js's recordCashPayment) - skips Stripe entirely,
    // so providerPaymentId/receiptFilename stay unset and no email goes
    // out. createdBy is the admin who recorded it, not the payer.
    method: {
      type: String,
      enum: ['stripe', 'cash'],
      default: 'stripe',
    },
    // --- purpose: 'tourAdvance' only ---
    tour: {
      type: Schema.Types.ObjectId,
      ref: 'Tour',
    },
    // Which attendee subdocuments this one payment covers - snapshotted
    // at payment-start time (name/amount as they were then), not looked
    // up fresh later, so a completed payment's own record stays a
    // faithful receipt even if e.g. the tour's pricing changes afterward.
    // A single payment can cover attendees spread across several
    // reservations (a family often has more than one).
    attendees: [
      {
        _id: false,
        reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation' },
        attendeeId: { type: Schema.Types.ObjectId },
        name: { type: String },
        amount: { type: Number },
      },
    ],
    // --- purpose: 'membershipFee' only (not implemented yet) ---
    // Expected shape once built: which member(s) this covers (a family
    // paying membership for several people at once, same "pay for your
    // family" spirit as tourAdvance) and which year it's for - left
    // undefined/unused until then rather than speculatively fleshed out
    // now.
    members: [
      {
        _id: false,
        user: { type: Schema.Types.ObjectId, ref: 'User' },
        name: { type: String },
        amount: { type: Number },
      },
    ],
    membershipYear: {
      type: Number,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: 'HUF',
    },
    // Stripe's own Checkout Session id (e.g. "cs_test_...") - null until
    // the session is created. Indexed since the webhook looks a payment
    // up by this, not our own _id (Stripe's webhook payload only ever
    // carries its own session id, via client_reference_id round-tripping
    // back to us separately - see paymentController.js).
    providerPaymentId: {
      type: String,
      index: true,
    },
    // Prepared: created locally, the Checkout Session not yet created
    // (or creating it failed). Started: session created, waiting on
    // Stripe's hosted page. Succeeded/Expired: derived from the session's
    // own payment_status/status - see paymentController.js. Failed/
    // Canceled are reachable in principle but Stripe Checkout's own UX
    // mostly just lets the payer retry on the same page instead of
    // surfacing those as terminal states the way Barion did.
    status: {
      type: String,
      enum: ['Prepared', 'Started', 'Succeeded', 'Failed', 'Canceled', 'Expired'],
      default: 'Prepared',
    },
    // Set once, right after the payment succeeds (see
    // paymentController.js's markPaymentSucceeded) - the receipt PDF's
    // filename under documents/payments/, not a full path (matches
    // documentController.js's own convention for its files). Absent for
    // any payment that never succeeded.
    receiptFilename: {
      type: String,
    },
  },
  { timestamps: true },
);

const Payment = mongoose.model('Payment', paymentSchema);

export default Payment;
