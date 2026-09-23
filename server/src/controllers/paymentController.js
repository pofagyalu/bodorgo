import fs from 'fs';
import path from 'path';
import Payment from '../models/paymentModel.js';
import Tour from '../models/tourModel.js';
import Reservation from '../models/reservationModel.js';
import User from '../models/userModel.js';
import { computeAttendeePayments } from './reservationController.js';
import { createCheckoutSession, retrieveCheckoutSession, constructWebhookEvent } from '../utils/stripe.js';
import { generateReceiptPdf, RECEIPTS_DIR } from '../utils/paymentReceipt.js';
import sendResendEmail from '../utils/resendEmail.js';
import AppError from '../utils/appError.js';
import config from '../config.js';
import logger from '../logger.js';

async function loadAttendeePayments(tourId) {
  const tour = await Tour.findById(tourId);
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }

  const reservations = await Reservation.find({ tour: tourId }).populate({
    path: 'attendees.user',
    select: 'role birthday familyId',
  });
  const { attendeePayments } = computeAttendeePayments(tour, reservations);
  return { tour, attendeePayments };
}

// Recomputes, from real server-side data, exactly who the caller is
// actually allowed to pay for and how much they owe right now - never
// trusts a client-supplied amount or attendee list beyond which ids they
// picked, since a tampered request could otherwise pay less than owed or
// pay for someone outside the caller's own family. Same isInMyPaymentGroup
// rule the client uses to build its own list (see tour.ts), reimplemented
// here in plain JS since this runs server-side against populated
// Mongoose data, not the client's AttendeePayment shape.
export async function resolvePayableAttendees(tourId, attendeeIds, user) {
  const { tour, attendeePayments } = await loadAttendeePayments(tourId);

  const requested = new Set(attendeeIds.map(String));
  const myFamilyId = user.familyId ? String(user.familyId) : null;

  const payable = attendeePayments.filter(
    (p) =>
      requested.has(p.attendeeId) &&
      p.advance != null &&
      !p.paid &&
      (p.userId === String(user._id) || (!!myFamilyId && p.familyId === myFamilyId)),
  );

  if (payable.length === 0) {
    throw new AppError('Nincs kiválasztható, még ki nem fizetett előleg.', 400);
  }

  return { tour, payable };
}

// Same lookup as resolvePayableAttendees, but for an admin recording a
// cash payment on someone else's behalf (see recordCashPayment below) -
// not restricted to the caller's own family, since an admin can be handed
// cash for any attendee on the tour, not just their own relatives.
export async function resolvePayableAttendeesForAdmin(tourId, attendeeIds) {
  const { tour, attendeePayments } = await loadAttendeePayments(tourId);

  const requested = new Set(attendeeIds.map(String));
  const payable = attendeePayments.filter((p) => requested.has(p.attendeeId) && p.advance != null && !p.paid);

  if (payable.length === 0) {
    throw new AppError('Nincs kiválasztható, még ki nem fizetett előleg.', 400);
  }

  return { tour, payable };
}

// POST /payments/start - requireAuth. Creates our own Payment record
// first (so we have something to correlate Stripe's webhook against via
// client_reference_id), then asks Stripe to actually start the Checkout
// Session.
export const startPayment = async (req, res) => {
  const { tourId, attendeeIds } = req.body;
  if (!tourId || !Array.isArray(attendeeIds) || attendeeIds.length === 0) {
    throw new AppError('Hiányzó vagy hibás adatok.', 400);
  }

  const { tour, payable } = await resolvePayableAttendees(tourId, attendeeIds, req.user);
  const amount = payable.reduce((sum, p) => sum + p.advance, 0);

  const payment = await Payment.create({
    purpose: 'tourAdvance',
    tour: tour._id,
    createdBy: req.user._id,
    attendees: payable.map((p) => ({
      reservationId: p.reservationId,
      attendeeId: p.attendeeId,
      name: p.name,
      amount: p.advance,
    })),
    amount,
  });

  // The payer's browser needs to land back wherever it actually started -
  // config.oridzs.clientBaseUrl is fixed to production (needed elsewhere,
  // e.g. links inside emails), so it's wrong when testing this flow from a
  // local dev client. The request's own Origin header (sent by the SPA's
  // fetch call) tells us exactly where the browser is running; only trust
  // it if it's one of the same origins CORS already allows, otherwise fall
  // back to the production default.
  const requestOrigin = req.headers.origin;
  const clientBase = config.corsOrigins.includes(requestOrigin)
    ? requestOrigin
    : config.oridzs.clientBaseUrl;
  // Same URL either way (success or the payer navigating back/canceling)
  // - the payment page itself figures out which happened by asking
  // GET /payments/:id/status once it sees ?paymentId= on load.
  const returnUrl = `${clientBase.replace(/\/$/, '')}/taborok/${tour._id}/befizetes?paymentId=${payment._id}`;

  let session;
  try {
    session = await createCheckoutSession({
      referenceId: String(payment._id),
      amount,
      payerEmail: req.user.email,
      successUrl: returnUrl,
      cancelUrl: returnUrl,
      description: `${tour.title} - előleg (${payable.map((p) => p.name).join(', ')})`,
    });
  } catch (err) {
    payment.status = 'Failed';
    await payment.save();
    throw new AppError('Nem sikerült elindítani a fizetést.', 502);
  }

  payment.providerPaymentId = session.id;
  payment.status = 'Started';
  await payment.save();

  res.status(200).json({ status: 'success', data: { gatewayUrl: session.url, paymentId: payment._id } });
};

// POST /payments/cash - requireAuth, restrictTo('admin'). For the real
// case where someone hands an admin cash instead of paying online - no
// Stripe involved at all, so this creates the Payment record already
// Succeeded and marks the attendees paid immediately. Deliberately no
// receipt/email here (see paymentModel.js's method field): there's no
// single payer email to send it to, and the profile page shows a plain
// "Készpénz" marker instead of a receipt-download link for these.
export const recordCashPayment = async (req, res) => {
  const { tourId, attendeeIds } = req.body;
  if (!tourId || !Array.isArray(attendeeIds) || attendeeIds.length === 0) {
    throw new AppError('Hiányzó vagy hibás adatok.', 400);
  }

  const { tour, payable } = await resolvePayableAttendeesForAdmin(tourId, attendeeIds);
  const amount = payable.reduce((sum, p) => sum + p.advance, 0);

  const payment = await Payment.create({
    purpose: 'tourAdvance',
    method: 'cash',
    tour: tour._id,
    createdBy: req.user._id,
    attendees: payable.map((p) => ({
      reservationId: p.reservationId,
      attendeeId: p.attendeeId,
      name: p.name,
      amount: p.advance,
    })),
    amount,
    status: 'Succeeded',
  });
  await markAttendeesPaid(payment);

  res.status(201).json({ status: 'success', data: { payment } });
};

// DELETE /payments/:id - requireAuth, restrictTo('admin'). Undoes a cash
// entry made by mistake (wrong row clicked) - reverts every attendee it
// covered back to unpaid and removes the record entirely. Deliberately
// refuses anything that isn't method: 'cash' - a real Stripe payment
// must never be reversible this way, since real money actually changed
// hands and this app has no refund flow behind it.
export const deleteCashPayment = async (req, res) => {
  const payment = await Payment.findById(req.params.id);
  if (!payment) {
    throw new AppError('No payment found with that ID!', 404);
  }
  if (payment.method !== 'cash') {
    throw new AppError('Csak készpénzes fizetés vonható vissza így.', 400);
  }

  for (const a of payment.attendees) {
    await Reservation.updateOne(
      { _id: a.reservationId, 'attendees._id': a.attendeeId },
      { $set: { 'attendees.$.paid': false } },
    );
  }
  await Payment.deleteOne({ _id: payment._id });

  res.status(204).json({ status: 'success', data: null });
};

function formatForint(amount) {
  return Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// A short, warm (not overly formal) confirmation - "Bódorgó" itself is
// named after wandering/rambling around, hence the sign-off.
function receiptEmailBody(payerName, tourTitle, attendees, total) {
  const lines = attendees.map((a) => `- ${a.name}: ${formatForint(a.amount)} Ft`).join('\n');
  const text = `Kedves ${payerName}!

Köszönjük, hogy befizetted a szállás előlegét magadnak és az alábbi résztvevőknek a(z) "${tourTitle}" táborhoz:

${lines}

Összesen: ${formatForint(total)} Ft

A fizetésről szóló igazolást mellékeltük ehhez az e-mailhez.

Jó bódorgást! 🏕️
A Bódorgó csapata`;

  const linesHtml = attendees.map((a) => `<li>${a.name}: ${formatForint(a.amount)} Ft</li>`).join('');
  const html = `<p>Kedves ${payerName}!</p>
<p>Köszönjük, hogy befizetted a szállás előlegét magadnak és az alábbi résztvevőknek a(z) "${tourTitle}" táborhoz:</p>
<ul>${linesHtml}</ul>
<p><strong>Összesen: ${formatForint(total)} Ft</strong></p>
<p>A fizetésről szóló igazolást mellékeltük ehhez az e-mailhez.</p>
<p>Jó bódorgást! 🏕️<br>A Bódorgó csapata</p>`;

  return { text, html };
}

// Shared by the Stripe path (markPaymentSucceeded) and the cash path
// (recordCashPayment) - the actual "this money has been received" effect
// on the tour's own bookkeeping, independent of which payment method got
// it there.
async function markAttendeesPaid(payment) {
  for (const a of payment.attendees) {
    await Reservation.updateOne(
      { _id: a.reservationId, 'attendees._id': a.attendeeId },
      { $set: { 'attendees.$.paid': true } },
    );
  }
}

// Marks every attendee this payment covers as paid, and the payment
// itself as Succeeded - shared by both the webhook and the user-facing
// status check below, since either can be the one that first learns the
// payment succeeded (whichever happens first wins; the other finds
// status already updated and does nothing further).
//
// tourAdvance-specific (updates Reservation.attendees, generates a
// receipt titled around "the tour's advance") - once membershipFee
// payments exist (see paymentModel.js), this will need to branch on
// payment.purpose instead.
async function markPaymentSucceeded(payment) {
  payment.status = 'Succeeded';
  await payment.save();
  await markAttendeesPaid(payment);

  // The receipt/email are a nice-to-have on top of the actual payment
  // already having succeeded (attendees are already marked paid above,
  // regardless of what happens next) - a failure here (e.g. the email
  // provider being briefly down) shouldn't make the payment look like it
  // failed, just gets logged for follow-up.
  try {
    const [payer, tour] = await Promise.all([
      User.findById(payment.createdBy).select('name email'),
      Tour.findById(payment.tour).select('title startDate'),
    ]);
    if (!payer?.email) return;

    const filename = await generateReceiptPdf(payment, payer.name, tour?.title ?? 'tábor', tour?.startDate);
    payment.receiptFilename = filename;
    await payment.save();

    const { text, html } = receiptEmailBody(payer.name, tour?.title ?? 'tábor', payment.attendees, payment.amount);
    await sendResendEmail({
      to: payer.email,
      subject: `Előleg befizetve - ${tour?.title ?? 'tábor'}`,
      text,
      html,
      attachments: [{ filename, content: fs.readFileSync(path.join(RECEIPTS_DIR, filename)) }],
    });
  } catch (err) {
    logger.error(`Payment ${payment._id}: receipt/email failed after a successful payment: ${err.message}`);
  }
}

// POST /payments/stripe/webhook - no auth (Stripe calls this server-to-
// server), but signature-verified instead - see app.js's own comment on
// why this one route needs the raw request body rather than the
// app-wide JSON-parsed one. Only checkout.session.completed actually
// matters here; other event types are acknowledged and ignored.
export const stripeWebhook = async (req, res) => {
  let event;
  try {
    event = constructWebhookEvent(req.body, req.headers['stripe-signature']);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const payment = await Payment.findOne({ providerPaymentId: session.id });
    if (payment && session.payment_status === 'paid' && payment.status !== 'Succeeded') {
      await markPaymentSucceeded(payment);
    }
  }

  res.status(200).end();
};

// GET /payments/:id/status - requireAuth. Polled by the payment page once
// the browser is redirected back from Stripe's Checkout page. Reconciles
// with Stripe directly (not just returning whatever the webhook already
// wrote) so the result shows correctly even if the async webhook is
// delayed, fails to arrive, or (on a dev machine) can't reach us at all -
// Stripe's servers have no way to POST to a local webhook endpoint, but
// this endpoint asking Stripe itself still works from anywhere.
export const getPaymentStatus = async (req, res) => {
  const payment = await Payment.findById(req.params.id);
  if (!payment) {
    throw new AppError('No payment found with that ID!', 404);
  }
  if (String(payment.createdBy) !== String(req.user._id)) {
    throw new AppError('Nincs jogosultságod ehhez a fizetéshez.', 403);
  }

  if (payment.status === 'Started' && payment.providerPaymentId) {
    const session = await retrieveCheckoutSession(payment.providerPaymentId);
    if (session.payment_status === 'paid' && payment.status !== 'Succeeded') {
      await markPaymentSucceeded(payment);
    } else if (session.status === 'expired' && payment.status !== 'Expired') {
      payment.status = 'Expired';
      await payment.save();
    }
  }

  res.status(200).json({ status: 'success', data: { status: payment.status, amount: payment.amount } });
};

// GET /payments/:id/receipt - requireAuth. Only the person who made the
// payment (or an admin) can download its receipt - unlike
// documentController.js's general /documents route, this can't be a
// plain "logged in, that's it" check, since the filename itself (date,
// real name) is guessable/informative enough that anyone logged in could
// otherwise fetch someone else's payment record.
export const downloadReceipt = async (req, res) => {
  const payment = await Payment.findById(req.params.id);
  if (!payment) {
    throw new AppError('No payment found with that ID!', 404);
  }
  if (String(payment.createdBy) !== String(req.user._id) && req.user.role !== 'admin') {
    throw new AppError('Nincs jogosultságod ehhez a fizetéshez.', 403);
  }
  if (!payment.receiptFilename) {
    throw new AppError('Ehhez a fizetéshez még nincs igazolás.', 404);
  }

  const filePath = path.join(RECEIPTS_DIR, payment.receiptFilename);
  if (!fs.existsSync(filePath)) {
    throw new AppError('Az igazolás fájlja nem található a szerveren.', 404);
  }

  res.download(filePath, payment.receiptFilename);
};
