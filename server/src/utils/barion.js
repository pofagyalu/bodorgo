import config from '../config.js';

// Barion keeps ~1.5% of every card payment as its own processing fee -
// unlike Stripe (whose fee just comes out of what the club receives,
// absorbed silently), this is passed on to the payer here, surfaced
// up-front before they ever reach Barion's page (see paymentController.js's
// startMembershipPayment/startPayment, and members.ts/payment.ts's own
// mirrored client-side constant for the confirmation screens).
export const BARION_FEE_RATE = 0.015;

function startUrl() {
  return `${config.barion.baseUrl}/v2/Payment/Start`;
}

function stateUrl(paymentId) {
  const url = new URL(`${config.barion.baseUrl}/v2/Payment/GetPaymentState`);
  url.searchParams.set('POSKey', config.barion.posKey);
  url.searchParams.set('PaymentId', paymentId);
  return url;
}

// Mirrors utils/stripe.js's createCheckoutSession contract exactly -
// { referenceId, amount, payerEmail, successUrl, description } in,
// { id, url } out either way - so paymentController.js can treat both
// gateways identically (Stripe's Checkout Session id/url, or Barion's
// PaymentId/GatewayUrl). Two real differences under the hood: Barion's
// Total is a plain decimal (HUF has no minor unit here - do NOT *100 the
// way Stripe's unit_amount needs), and there's no separate cancel URL -
// Barion redirects to the same RedirectUrl regardless of outcome, with
// the actual result only ever confirmed via getBarionPaymentState below,
// same as Stripe's own retrieveCheckoutSession reconciliation.
export async function createBarionPayment({ referenceId, amount, payerEmail, successUrl, description }) {
  const callbackUrl = `${config.apiBaseUrl.replace(/\/$/, '')}/payments/barion/callback`;

  const res = await fetch(startUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      POSKey: config.barion.posKey,
      PaymentType: 'Immediate',
      GuestCheckOut: true,
      FundingSources: ['All'],
      PaymentRequestId: referenceId,
      PayerHint: payerEmail,
      RedirectUrl: successUrl,
      CallbackUrl: callbackUrl,
      Locale: 'hu-HU',
      Currency: 'HUF',
      Transactions: [
        {
          POSTransactionId: referenceId,
          Payee: config.barion.payeeEmail,
          Total: amount,
          Comment: description,
          // Barion requires at least one line item per transaction (a
          // plain amount alone isn't accepted) - this app has no real
          // per-item breakdown to offer, so one line covering the whole
          // total stands in for it.
          Items: [
            {
              Name: description,
              Description: description,
              Quantity: 1,
              Unit: 'db',
              UnitPrice: amount,
              ItemTotal: amount,
            },
          ],
        },
      ],
    }),
  });

  const data = await res.json();
  if (!res.ok || (data.Errors && data.Errors.length > 0)) {
    const message = data.Errors?.map((e) => e.Description || e.Title).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Barion payment start failed: ${message}`);
  }

  return { id: data.PaymentId, url: data.GatewayUrl };
}

// Barion's own callback ping carries no verifiable signature at all -
// it's just a "something happened, go check" trigger (see
// paymentController.js's barionCallback) - so the real status always
// comes from this API call, never trusted from the callback or the
// browser's own redirect alone. Same defensive role as Stripe's
// retrieveCheckoutSession, called the same way from getPaymentStatus.
export async function getBarionPaymentState(paymentId) {
  const res = await fetch(stateUrl(paymentId));
  if (!res.ok) {
    throw new Error(`Barion GetPaymentState failed: HTTP ${res.status}`);
  }
  return res.json();
}
