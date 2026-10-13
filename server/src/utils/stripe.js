import Stripe from 'stripe';
import config from '../config.js';

// Two Stripe accounts, since one pays out to one bank account: 'membership'
// (the club's - dues) and 'tour' (advances) - see config.js's
// stripe.accounts. Both can be the same account (the same key twice).
const clients = new Map();

// Whether this account's key is set - without it that purpose takes no
// Stripe payments (paymentController.js) and its button is greyed out.
export const stripeAccountReady = (account) => !!config.stripe.accounts[account]?.secretKey;

function clientFor(account) {
  const { secretKey } = config.stripe.accounts[account];
  if (!clients.has(secretKey)) clients.set(secretKey, new Stripe(secretKey));
  return clients.get(secretKey);
}

// Starts a Stripe Checkout session - Stripe's own hosted payment page,
// same "redirect the browser there, redirect back once done" shape as
// this project's earlier Barion attempt. referenceId is our own Payment
// document's _id (as a string): our one-to-one correlation key, stored
// as Checkout's own client_reference_id.
//
// unit_amount is in HUF's smallest unit (fillér) - HUF is charged as an
// ordinary 2-decimal currency in Stripe (confirmed against their docs;
// it's only special-cased for *payouts*, not charges), unlike genuinely
// zero-decimal currencies like JPY. Getting this wrong would silently
// charge 100x too much or too little.
export async function createCheckoutSession({
  account,
  referenceId,
  amount,
  payerEmail,
  successUrl,
  cancelUrl,
  description,
}) {
  return clientFor(account).checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: payerEmail,
    client_reference_id: referenceId,
    line_items: [
      {
        price_data: {
          currency: 'huf',
          product_data: { name: description },
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

export async function retrieveCheckoutSession(sessionId, account) {
  return clientFor(account).checkout.sessions.retrieve(sessionId);
}

// Verifies a webhook request genuinely came from Stripe (not a forged
// POST claiming a payment succeeded) - needs the RAW request body, not
// the JSON-parsed one, so the route this is used from must be mounted
// with express.raw() instead of the app-wide express.json() - see
// app.js's own comment on that route. Both accounts call the same route,
// each signing with its own secret - whichever fits.
export function constructWebhookEvent(rawBody, signature) {
  const secrets = new Set(
    Object.values(config.stripe.accounts)
      .map((a) => a.webhookSecret)
      .filter(Boolean),
  );
  let lastError = new Error('No Stripe webhook secret is set.');
  for (const secret of secrets) {
    try {
      return Stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

// --- Payouts: an account's balance to its own bank account ---
//
// The bank account is the one set for the account in the Stripe Dashboard -
// never taken from this app, so nothing here can redirect the money. HUF
// amounts are in fillér at Stripe (like charges), whole forints here.

const hufOf = (entries = []) =>
  Math.floor((entries.find((e) => e.currency === 'huf')?.amount ?? 0) / 100);

const payoutView = (p) => ({
  id: p.id,
  amount: Math.round(p.amount / 100),
  status: p.status, // paid, pending, in_transit, canceled, failed
  createdAt: new Date(p.created * 1000).toISOString(),
  arrivalDate: p.arrival_date ? new Date(p.arrival_date * 1000).toISOString() : null,
});

// What can be paid out now, what is still on its way from the cards, the
// bank account it goes to, whether Stripe pays out by itself (schedule other
// than 'manual'), and the latest payouts.
export async function getStripePayoutState(account) {
  const stripe = clientFor(account);
  const [balance, payouts, self] = await Promise.all([
    stripe.balance.retrieve(),
    stripe.payouts.list({ limit: 5 }),
    stripe.accounts.retrieveCurrent(),
  ]);
  const banks = (self.external_accounts?.data ?? []).filter((a) => a.object === 'bank_account');
  const bank = banks.find((a) => a.currency === 'huf' && a.default_for_currency) ?? banks[0];
  return {
    // false with a test key: pretend money from test cards.
    livemode: balance.livemode,
    available: hufOf(balance.available),
    pending: hufOf(balance.pending),
    bank: bank ? { bankName: bank.bank_name ?? '', last4: bank.last4 ?? '' } : null,
    schedule: self.settings?.payouts?.schedule?.interval ?? null,
    payouts: payouts.data.map(payoutView),
  };
}

export async function createStripePayout(account, amount) {
  return payoutView(
    await clientFor(account).payouts.create({ amount: Math.round(amount * 100), currency: 'huf' }),
  );
}
