// Verifies the real Stripe connection end-to-end - creates a genuine
// Checkout Session against Stripe's test-mode API (confirms
// STRIPE_SECRET_KEY is valid and correctly formatted), then immediately
// expires it again so no stray open session is left behind in the
// dashboard.
//
// Usage:
//   node scripts/testStripeCheckoutSession.js

import 'dotenv/config';
import Stripe from 'stripe';
import config from '../src/config.js';
import { createCheckoutSession } from '../src/utils/stripe.js';

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

const session = await createCheckoutSession({
  referenceId: 'test-connection-check',
  amount: 500, // 500 Ft
  payerEmail: 'teszt@example.com',
  successUrl: 'https://bodorgo.hu/taborok/x/befizetes?paymentId=test',
  cancelUrl: 'https://bodorgo.hu/taborok/x/befizetes?paymentId=test',
  description: 'Kapcsolat teszt',
});

check('a real Checkout Session id came back (cs_test_...)', session.id.startsWith('cs_test_'));
check('a real Checkout gateway URL came back', session.url?.startsWith('https://checkout.stripe.com/'));
check('the amount was correctly converted to fillér (500 Ft -> 50000)', session.amount_total === 50000);
check('currency is HUF', session.currency === 'huf');

// Clean up - no reason to leave a stray open test session sitting in the
// Stripe dashboard.
const stripe = new Stripe(config.stripe.secretKey);
await stripe.checkout.sessions.expire(session.id);
console.log('\nExpired the test Checkout Session.');

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed - Stripe connection is working.');
