import Stripe from 'stripe';
import config from '../config.js';

const stripe = new Stripe(config.stripe.secretKey);

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
export async function createCheckoutSession({ referenceId, amount, payerEmail, successUrl, cancelUrl, description }) {
  return stripe.checkout.sessions.create({
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

export async function retrieveCheckoutSession(sessionId) {
  return stripe.checkout.sessions.retrieve(sessionId);
}

// Verifies a webhook request genuinely came from Stripe (not a forged
// POST claiming a payment succeeded) - needs the RAW request body, not
// the JSON-parsed one, so the route this is used from must be mounted
// with express.raw() instead of the app-wide express.json() - see
// app.js's own comment on that route.
export function constructWebhookEvent(rawBody, signature) {
  return stripe.webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
}
