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
    // stripe/barion: the two self-service Checkout-style flows, both
    // driving providerPaymentId/status through the same shared
    // markPaymentSucceeded machinery (see paymentController.js) despite
    // being different gateways underneath. cash: an admin recording money
    // they were handed in person (see recordCashPayment) - skips both
    // gateways entirely, so providerPaymentId/receiptFilename stay unset
    // and no email goes out. createdBy is the admin who recorded it, not
    // the payer.
    method: {
      type: String,
      enum: ['stripe', 'barion', 'cash'],
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
    // --- purpose: 'membershipFee' only ---
    // Which member(s) this covers - a family paying dues for several
    // people at once, same "pay for your family" spirit as tourAdvance -
    // and which single year each one is for (a family's members can each
    // owe a different earliest-unpaid year, so this lives per-entry
    // rather than once for the whole payment - see
    // paymentController.js's resolvePayableMembers).
    members: [
      {
        _id: false,
        user: { type: Schema.Types.ObjectId, ref: 'User' },
        name: { type: String },
        amount: { type: Number },
        membershipYear: { type: Number },
      },
    ],
    // Unused by membershipFee (see members[].membershipYear above) -
    // left in case a future purpose wants one shared year for a whole
    // payment instead.
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
    // The gateway's own id for this payment - Stripe's Checkout Session id
    // (e.g. "cs_test_...") or Barion's PaymentId (a GUID) - null until that
    // session/payment is created. Indexed since both the Stripe webhook
    // and the Barion callback look a payment up by this, not our own _id
    // (see paymentController.js).
    providerPaymentId: {
      type: String,
      index: true,
    },
    // Prepared: created locally, the gateway session/payment not yet
    // created (or creating it failed). Started: gateway session created,
    // waiting on its hosted page. Succeeded/Expired/Canceled: derived from
    // the gateway's own status - Stripe's payment_status/status for a
    // Checkout Session, or Barion's own Status field via GetPaymentState -
    // see paymentController.js.
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
