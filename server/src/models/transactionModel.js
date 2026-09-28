import mongoose from 'mongoose';

const { Schema } = mongoose;

// A fixed, curated list per type rather than a free-text field or a hard
// Mongoose enum - keeps the add-transaction form's category dropdown
// predictable while still letting the list grow later with just a code
// change here (financeController.js validates against these, not a
// schema-level enum).
export const INCOME_CATEGORIES = ['Tagdíj', '1% SZJA felajánlás'];
export const EXPENSE_CATEGORIES = ['Szállásköltség', 'Banki költségek', 'Egyéb', 'Ajándék'];

// One entry in the club's own income/expense ledger (Bevétel/Kiadás) -
// separate from Payment (which is specifically a Stripe/cash payment
// attempt tied to a tour advance or, once built, a membership fee). Once
// membershipFee payments exist, each one is expected to also create a
// Transaction here (income, category 'Tagdíj') so the club's overall
// finances stay in one place - not wired up yet since that payment flow
// itself doesn't exist yet.
const transactionSchema = new Schema(
  {
    date: {
      type: Date,
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['income', 'expense'],
      required: true,
    },
    category: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      enum: ['HUF', 'EUR'],
      default: 'HUF',
    },
    // The admin who recorded it - every transaction is currently
    // admin-entered, but this also identifies the source once a
    // membership-fee payment starts creating these automatically.
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Only set for category:'Tagdíj' income entries - which member this
    // particular year's dues payment is for, so the Klub Felhasználók/
    // Áttekintés pages can look up real paid/unpaid status per member per
    // year (see members.ts/overview.ts's yearState) instead of every
    // Tagdíj transaction just being an anonymous lump sum. Absent for
    // every other transaction (e.g. a general "Éves tagdíjak" entry not
    // tied to one specific member, or any expense).
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    membershipYear: {
      type: Number,
    },
    // A dues payment's own record (Payment) and how it was paid - an
    // admin-recorded cash payment can be undone (DELETE /payments/:id),
    // which removes this transaction with it; an online one can't.
    payment: {
      type: Schema.Types.ObjectId,
      ref: 'Payment',
    },
    paymentMethod: {
      type: String,
      enum: ['barion', 'stripe', 'cash'],
    },
  },
  { timestamps: true },
);

const Transaction = mongoose.model('Transaction', transactionSchema);

export default Transaction;
