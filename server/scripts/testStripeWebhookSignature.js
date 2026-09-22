// Verifies constructWebhookEvent (see utils/stripe.js) actually enforces
// STRIPE_WEBHOOK_SECRET - the security-critical part of the webhook
// route, since without this check anyone could POST a fake "payment
// succeeded" event and get an attendee marked paid for free. Uses
// Stripe's own generateTestHeaderString helper to sign a payload exactly
// the way a real webhook request would be, rather than needing a real
// webhook call (which can't reach a dev machine anyway).
//
// Usage:
//   node scripts/testStripeWebhookSignature.js

import 'dotenv/config';
import Stripe from 'stripe';
import config from '../src/config.js';
import { constructWebhookEvent } from '../src/utils/stripe.js';

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

const stripe = new Stripe(config.stripe.secretKey);

const payload = JSON.stringify({
  id: 'evt_test_123',
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_test_123', payment_status: 'paid' } },
});

// --- A correctly-signed payload is accepted and parsed ---
{
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: config.stripe.webhookSecret,
  });
  const event = constructWebhookEvent(payload, signature);
  check('a genuinely-signed payload is accepted', event.type === 'checkout.session.completed');
  check('the event data is parsed correctly', event.data.object.id === 'cs_test_123');
}

// --- A payload signed with the WRONG secret is rejected ---
{
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: 'whsec_totally_wrong_secret',
  });
  let threw = false;
  try {
    constructWebhookEvent(payload, signature);
  } catch (err) {
    threw = true;
  }
  check('a payload signed with the wrong secret is rejected', threw);
}

// --- A missing/garbage signature header is rejected ---
{
  let threw = false;
  try {
    constructWebhookEvent(payload, 'not-a-real-signature');
  } catch (err) {
    threw = true;
  }
  check('a garbage signature header is rejected', threw);
}

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed - webhook signature verification is working.');
