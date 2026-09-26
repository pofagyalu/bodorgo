import fs from 'fs';
import path from 'path';
import Payment from '../models/paymentModel.js';
import Tour from '../models/tourModel.js';
import Reservation from '../models/reservationModel.js';
import User from '../models/userModel.js';
import Transaction from '../models/transactionModel.js';
import { computeAttendeePayments } from './reservationController.js';
import { createCheckoutSession, retrieveCheckoutSession, constructWebhookEvent } from '../utils/stripe.js';
import { createBarionPayment, getBarionPaymentState, createBarionWithdrawal, BARION_FEE_RATE } from '../utils/barion.js';
import { generateReceiptPdf, RECEIPTS_DIR } from '../utils/paymentReceipt.js';
import sendResendEmail from '../utils/resendEmail.js';
import AppError from '../utils/appError.js';
import config from '../config.js';
import logger from '../logger.js';
import { CLUB_FOUNDING_YEAR, feeForYear, getClubSettings } from '../utils/clubSettings.js';

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

// Club membership dues: a yearly fee set by an admin on the Klub →
// Beállítások page (by the year it takes effect - see
// utils/clubSettings.js), tracked as real Transaction entries (see
// transactionModel.js's user/membershipYear fields) rather than
// Reservation attendees - "paid" means a Tagdíj income transaction
// already exists for that person+year (same rule members.ts/overview.ts
// use client-side).

// Same "self + same family" rule as resolvePayableAttendees, but for
// membership dues rather than a tour advance - the payer picks exactly
// which person+year pairs to cover (see members.ts's payBreakdown/
// selectedPayIds, one checkbox per outstanding year per person, not just
// each person's single earliest one), and each pair is re-validated fresh
// here (real family member, real outstanding year, fixed amount) - never
// trusted from the request as-is.
async function resolvePayableMembers(items, user) {
  const myFamilyId = user.familyId ? String(user.familyId) : null;
  const userIds = [...new Set(items.map((i) => String(i.userId)))];

  const candidates = await User.find({
    _id: { $in: userIds },
    role: { $in: ['admin', 'member'] },
    $or: [{ _id: user._id }, ...(myFamilyId ? [{ familyId: myFamilyId }] : [])],
  }).select('name memberSince');
  const candidateById = new Map(candidates.map((c) => [String(c._id), c]));

  const paidTransactions = await Transaction.find({
    type: 'income',
    category: 'Tagdíj',
    user: { $in: userIds },
  }).select('user membershipYear');
  const paidYearsByUser = new Map();
  for (const t of paidTransactions) {
    const key = String(t.user);
    if (!paidYearsByUser.has(key)) paidYearsByUser.set(key, new Set());
    paidYearsByUser.get(key).add(t.membershipYear);
  }

  const { membershipFees } = await getClubSettings();
  const currentYear = new Date().getFullYear();
  const seen = new Set();
  const payable = [];
  for (const { userId, year } of items) {
    const member = candidateById.get(String(userId));
    const y = Number(year);
    if (!member || !Number.isInteger(y)) continue;

    const startYear = member.memberSince ?? CLUB_FOUNDING_YEAR;
    if (y < startYear || y > currentYear) continue;

    const paidYears = paidYearsByUser.get(String(member._id)) ?? new Set();
    if (paidYears.has(y)) continue;

    const key = `${member._id}:${y}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const amount = feeForYear(membershipFees, y);
    if (!amount) continue; // no fee set for that year - nothing to pay
    payable.push({ _id: member._id, name: member.name, year: y, amount });
  }

  if (payable.length === 0) {
    throw new AppError('Nincs esedékes tagdíj a kiválasztott tagoknak és évekre.', 400);
  }

  return payable;
}

// Starts the actual gateway-side payment for whichever method the client
// chose (anything but 'barion' falls back to Stripe) - a thin,
// gateway-agnostic wrapper so startPayment/startMembershipPayment below
// don't each duplicate the branch. Both gateways return an object with
// .id/.url either way (see utils/barion.js's own comment on why that
// shape was chosen to mirror Stripe's Checkout Session exactly).
function startGatewayPayment(method, { referenceId, amount, payerEmail, successUrl, description, payeeEmail }) {
  if (method === 'barion') {
    return createBarionPayment({ referenceId, amount, payerEmail, successUrl, description, payeeEmail });
  }
  return createCheckoutSession({ referenceId, amount, payerEmail, successUrl, cancelUrl: successUrl, description });
}

// Barion's own ~1.6% cut (see utils/barion.js's BARION_FEE_RATE) is passed
// on to the payer rather than absorbed by the club - this is what actually
// gets charged and stored as Payment.amount, while each covered
// attendee/member still keeps their own real, un-surcharged amount (see
// payable's .advance/.amount below) for the Reservation/Transaction records
// created once the payment succeeds. Stripe's own fee isn't handled this
// way (out of scope here), hence the method check.
function chargeableAmount(subtotal, method) {
  return method === 'barion' ? Math.round(subtotal * (1 + BARION_FEE_RATE)) : subtotal;
}

// POST /payments/membership/start - requireAuth. Same gateway-agnostic
// start machinery as startPayment below (Stripe or Barion, see
// startGatewayPayment), just for a club member's own yearly dues instead
// of a tour advance - one payment can cover several outstanding
// person+year pairs at once (several family members, and/or several
// unpaid years for the same person), exactly as chosen in the confirm
// dialog client-side.
export const startMembershipPayment = async (req, res) => {
  const { items } = req.body;
  const method = req.body.method === 'barion' ? 'barion' : 'stripe';
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError('Nincs kiválasztott tagdíj tétel.', 400);
  }

  const payable = await resolvePayableMembers(items, req.user);
  const subtotal = payable.reduce((sum, p) => sum + p.amount, 0);
  const amount = chargeableAmount(subtotal, method);

  const payment = await Payment.create({
    purpose: 'membershipFee',
    method,
    createdBy: req.user._id,
    members: payable.map((p) => ({
      user: p._id,
      name: p.name,
      amount: p.amount,
      membershipYear: p.year,
    })),
    amount,
  });

  // Same origin-detection reasoning as startPayment below.
  const requestOrigin = req.headers.origin;
  const clientBase = config.corsOrigins.includes(requestOrigin)
    ? requestOrigin
    : config.oridzs.clientBaseUrl;
  const returnUrl = `${clientBase.replace(/\/$/, '')}/klub/felhasznalok?paymentId=${payment._id}`;

  let gatewayPayment;
  try {
    gatewayPayment = await startGatewayPayment(method, {
      referenceId: String(payment._id),
      amount,
      payerEmail: req.user.email,
      successUrl: returnUrl,
      description: `Tagdíj - ${payable.map((p) => `${p.name} (${p.year})`).join(', ')}`,
      payeeEmail: config.barion.membership.payeeEmail,
    });
  } catch (err) {
    payment.status = 'Failed';
    await payment.save();
    throw new AppError('Nem sikerült elindítani a fizetést.', 502);
  }

  payment.providerPaymentId = gatewayPayment.id;
  payment.status = 'Started';
  await payment.save();

  res.status(200).json({ status: 'success', data: { gatewayUrl: gatewayPayment.url, paymentId: payment._id } });
};

// POST /payments/start - requireAuth. Creates our own Payment record
// first (so we have something to correlate the gateway's webhook/callback
// against), then asks the chosen gateway (Stripe or Barion, see
// startGatewayPayment) to actually start the payment.
export const startPayment = async (req, res) => {
  const { tourId, attendeeIds } = req.body;
  const method = req.body.method === 'barion' ? 'barion' : 'stripe';
  if (!tourId || !Array.isArray(attendeeIds) || attendeeIds.length === 0) {
    throw new AppError('Hiányzó vagy hibás adatok.', 400);
  }

  const { tour, payable } = await resolvePayableAttendees(tourId, attendeeIds, req.user);
  const subtotal = payable.reduce((sum, p) => sum + p.advance, 0);
  const amount = chargeableAmount(subtotal, method);

  const payment = await Payment.create({
    purpose: 'tourAdvance',
    method,
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

  let gatewayPayment;
  try {
    gatewayPayment = await startGatewayPayment(method, {
      referenceId: String(payment._id),
      amount,
      payerEmail: req.user.email,
      successUrl: returnUrl,
      description: `${tour.title} - előleg (${payable.map((p) => p.name).join(', ')})`,
      payeeEmail: config.barion.tour.payeeEmail,
    });
  } catch (err) {
    payment.status = 'Failed';
    await payment.save();
    throw new AppError('Nem sikerült elindítani a fizetést.', 502);
  }

  payment.providerPaymentId = gatewayPayment.id;
  payment.status = 'Started';
  await payment.save();

  res.status(200).json({ status: 'success', data: { gatewayUrl: gatewayPayment.url, paymentId: payment._id } });
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

  // Same "collection just completed" notification as the online-payment
  // path (markPaymentSucceeded) - a cash handover recorded by an admin can
  // just as easily be the last outstanding one for this tour.
  try {
    await notifyAdminsIfTourFullyPaid(String(tour._id), tour.title);
  } catch (err) {
    logger.error(`Payment ${payment._id}: admin full-payment notification failed: ${err.message}`);
  }

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
// feeAmount is the gap between the attendees' own advances and what was
// actually charged (Barion's ~1.6% cut, passed on to the payer - see
// chargeableAmount above) - 0 for a Stripe payment, so the line is skipped
// entirely and the total just matches the rows as before.
function receiptEmailBody(payerName, tourTitle, attendees, total, feeAmount = 0) {
  const lines = attendees.map((a) => `- ${a.name}: ${formatForint(a.amount)} Ft`).join('\n');
  const feeLine = feeAmount > 0 ? `\nBarion díj (1,6%): ${formatForint(feeAmount)} Ft` : '';
  const text = `Kedves ${payerName}!

Köszönjük, hogy befizetted a szállás előlegét magadnak és az alábbi résztvevőknek a(z) "${tourTitle}" táborhoz:

${lines}
${feeLine}
Összesen: ${formatForint(total)} Ft

A fizetésről szóló igazolást mellékeltük ehhez az e-mailhez.

Jó bódorgást! 🏕️
A Bódorgó csapata`;

  const linesHtml = attendees.map((a) => `<li>${a.name}: ${formatForint(a.amount)} Ft</li>`).join('');
  const feeLineHtml = feeAmount > 0 ? `<li>Barion díj (1,6%): ${formatForint(feeAmount)} Ft</li>` : '';
  const html = `<p>Kedves ${payerName}!</p>
<p>Köszönjük, hogy befizetted a szállás előlegét magadnak és az alábbi résztvevőknek a(z) "${tourTitle}" táborhoz:</p>
<ul>${linesHtml}${feeLineHtml}</ul>
<p><strong>Összesen: ${formatForint(total)} Ft</strong></p>
<p>A fizetésről szóló igazolást mellékeltük ehhez az e-mailhez.</p>
<p>Jó bódorgást! 🏕️<br>A Bódorgó csapata</p>`;

  return { text, html };
}

// Membership-dues equivalent of receiptEmailBody above - each covered
// member gets their own line with the specific year it paid off, since
// (unlike a tour advance) a family payment can cover different years for
// different people.
function membershipReceiptEmailBody(payerName, members, total, feeAmount = 0) {
  const lines = members.map((m) => `- ${m.name} (${m.membershipYear}. év): ${formatForint(m.amount)} Ft`).join('\n');
  const feeLine = feeAmount > 0 ? `\nBarion díj (1,6%): ${formatForint(feeAmount)} Ft` : '';
  const text = `Kedves ${payerName}!

Köszönjük a klubtagsági díj befizetését:

${lines}
${feeLine}
Összesen: ${formatForint(total)} Ft

A fizetésről szóló igazolást mellékeltük ehhez az e-mailhez.

Jó bódorgást! 🏕️
A Bódorgó csapata`;

  const feeLineHtml = feeAmount > 0 ? `<li>Barion díj (1,6%): ${formatForint(feeAmount)} Ft</li>` : '';
  const linesHtml = members
    .map((m) => `<li>${m.name} (${m.membershipYear}. év): ${formatForint(m.amount)} Ft</li>`)
    .join('');
  const html = `<p>Kedves ${payerName}!</p>
<p>Köszönjük a klubtagsági díj befizetését:</p>
<ul>${linesHtml}${feeLineHtml}</ul>
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

// Fires once collection for the current year genuinely completes - every
// role admin/member user eligible for it (memberSince at or before this
// year, same rule resolvePayableMembers itself uses) has a real Tagdíj
// Transaction for it. Only ever true right after whichever payment happens
// to be the last outstanding one, since resolvePayableMembers would refuse
// to charge anyone again once they're already paid - so this naturally
// notifies exactly once per year, no separate dedup bookkeeping needed.
async function notifyAdminsIfMembershipFullyPaid() {
  const currentYear = new Date().getFullYear();
  const members = await User.find({ role: { $in: ['admin', 'member'] } }).select('memberSince');
  const eligible = members.filter((m) => (m.memberSince ?? CLUB_FOUNDING_YEAR) <= currentYear);
  if (eligible.length === 0) return;

  const paidTransactions = await Transaction.find({
    type: 'income',
    category: 'Tagdíj',
    membershipYear: currentYear,
    user: { $in: eligible.map((m) => m._id) },
  }).select('user');
  const paidUserIds = new Set(paidTransactions.map((t) => String(t.user)));
  const allPaid = eligible.every((m) => paidUserIds.has(String(m._id)));
  if (!allPaid) return;

  const admins = await User.find({ role: 'admin' }).select('email');
  const adminEmails = admins.map((a) => a.email).filter(Boolean);
  if (adminEmails.length === 0) return;

  await sendResendEmail({
    to: adminEmails,
    subject: `Minden klubtag befizette a(z) ${currentYear}. évi tagdíjat`,
    text: `Minden klubtag (${eligible.length} fő) befizette a(z) ${currentYear}. évi tagdíjat.`,
    html: `<p>Minden klubtag (${eligible.length} fő) befizette a(z) <strong>${currentYear}</strong>. évi tagdíjat.</p>`,
  });
}

// Tour-advance equivalent of notifyAdminsIfMembershipFullyPaid above - a
// tour's own collection completes once every attendee who actually owes an
// advance (same "advance != null && !paid" rule payment.ts itself filters
// on client-side) has paid it. feeExempt attendees are always paid:true
// with advance:0 already (see computeAttendeePayments), so they never
// count as still owing.
async function notifyAdminsIfTourFullyPaid(tourId, tourTitle) {
  const { attendeePayments } = await loadAttendeePayments(tourId);
  if (attendeePayments.length === 0) return;

  const stillOwing = attendeePayments.some((p) => p.advance != null && !p.paid);
  if (stillOwing) return;

  const admins = await User.find({ role: 'admin' }).select('email');
  const adminEmails = admins.map((a) => a.email).filter(Boolean);
  if (adminEmails.length === 0) return;

  await sendResendEmail({
    to: adminEmails,
    subject: `Mindenki befizette az előleget - ${tourTitle}`,
    text: `A(z) "${tourTitle}" táborhoz mindenki (${attendeePayments.length} fő) befizette az előleget.`,
    html: `<p>A(z) <strong>${tourTitle}</strong> táborhoz mindenki (${attendeePayments.length} fő) befizette az előleget.</p>`,
  });
}

// membershipFee's own "money received" effect - one real Transaction per
// covered member+year (see transactionModel.js's user/membershipYear
// fields), so the Klub Pénzügyek/Felhasználók/Áttekintés pages
// immediately reflect it - plus a receipt/email, same as tourAdvance
// below, using the dues-specific wording (see paymentReceipt.js's
// isMembership branch and membershipReceiptEmailBody above).
async function markMembershipPaid(payment) {
  for (const m of payment.members) {
    await Transaction.create({
      date: new Date(),
      name: `${m.name} tagdíja (${m.membershipYear})`,
      type: 'income',
      category: 'Tagdíj',
      amount: m.amount,
      currency: payment.currency,
      createdBy: payment.createdBy,
      user: m.user,
      membershipYear: m.membershipYear,
    });
  }

  // Same "don't fail the payment over a receipt/email hiccup" reasoning
  // as markPaymentSucceeded's tourAdvance path - the Transactions above
  // already stand regardless of what happens next.
  try {
    const payer = await User.findById(payment.createdBy).select('name email');
    if (!payer?.email) return;

    const filename = await generateReceiptPdf(payment, payer.name, null, null);
    payment.receiptFilename = filename;
    await payment.save();

    const subtotal = payment.members.reduce((sum, m) => sum + m.amount, 0);
    const feeAmount = payment.amount - subtotal;
    const { text, html } = membershipReceiptEmailBody(payer.name, payment.members, payment.amount, feeAmount);
    await sendResendEmail({
      to: payer.email,
      subject: 'Tagdíj befizetve - Bódorgó Klub',
      text,
      html,
      attachments: [{ filename, content: fs.readFileSync(path.join(RECEIPTS_DIR, filename)) }],
    });
  } catch (err) {
    logger.error(`Payment ${payment._id}: membership receipt/email failed after a successful payment: ${err.message}`);
  }

  // Separate try/catch from the payer's own receipt above - one failing
  // (e.g. Resend briefly down) shouldn't skip the other, and this check
  // needs to run regardless of whether the payer even has an email on file.
  try {
    await notifyAdminsIfMembershipFullyPaid();
  } catch (err) {
    logger.error(`Payment ${payment._id}: admin full-payment notification failed: ${err.message}`);
  }
}

// Marks the payment itself as Succeeded and applies whichever purpose-
// specific effect actually means "this money has been received" - shared
// by both the webhook and the user-facing status check below, since
// either can be the one that first learns the payment succeeded
// (whichever happens first wins; the other finds status already updated
// and does nothing further).
async function markPaymentSucceeded(payment) {
  payment.status = 'Succeeded';
  await payment.save();

  if (payment.purpose === 'membershipFee') {
    await markMembershipPaid(payment);
    return;
  }

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

    const subtotal = payment.attendees.reduce((sum, a) => sum + a.amount, 0);
    const feeAmount = payment.amount - subtotal;
    const { text, html } = receiptEmailBody(payer.name, tour?.title ?? 'tábor', payment.attendees, payment.amount, feeAmount);
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

  // Same isolation reasoning as markMembershipPaid's own admin-notify call
  // above - independent of the payer's own receipt succeeding or failing.
  try {
    const tour = await Tour.findById(payment.tour).select('title');
    if (tour) await notifyAdminsIfTourFullyPaid(String(payment.tour), tour.title);
  } catch (err) {
    logger.error(`Payment ${payment._id}: admin full-payment notification failed: ${err.message}`);
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

// GET /payments/barion/callback?paymentId=... - no auth (Barion calls this
// server-to-server), and unlike Stripe's webhook there's no signature to
// verify at all - Barion's callback is just an unauthenticated "something
// changed, go check" ping (see utils/barion.js's own comment). The real
// status always comes from a fresh GetPaymentState call, never trusted
// from this ping's own query string.
export const barionCallback = async (req, res) => {
  const paymentId = req.query.paymentId || req.query.PaymentId;
  if (!paymentId) {
    return res.status(400).end();
  }

  const payment = await Payment.findOne({ providerPaymentId: paymentId, method: 'barion' });
  if (payment && payment.status !== 'Succeeded') {
    try {
      const state = await getBarionPaymentState(paymentId);
      if (state.Status === 'Succeeded') {
        await markPaymentSucceeded(payment);
      } else if ((state.Status === 'Expired' || state.Status === 'Canceled') && payment.status !== 'Expired') {
        payment.status = state.Status === 'Canceled' ? 'Canceled' : 'Expired';
        await payment.save();
      }
    } catch (err) {
      logger.error(`Barion callback: state check failed for payment ${payment._id}: ${err.message}`);
    }
  }

  res.status(200).end();
};

// GET /payments/:id/status - requireAuth. Polled by the payment page once
// the browser is redirected back from the gateway's hosted checkout page.
// Reconciles with the gateway directly (not just returning whatever the
// webhook/callback already wrote) so the result shows correctly even if
// that async notification is delayed, fails to arrive, or (on a dev
// machine) can't reach us at all - neither gateway can POST/GET to a local
// endpoint, but this endpoint asking the gateway itself still works from
// anywhere.
export const getPaymentStatus = async (req, res) => {
  const payment = await Payment.findById(req.params.id);
  if (!payment) {
    throw new AppError('No payment found with that ID!', 404);
  }
  if (String(payment.createdBy) !== String(req.user._id)) {
    throw new AppError('Nincs jogosultságod ehhez a fizetéshez.', 403);
  }

  if (payment.status === 'Started' && payment.providerPaymentId) {
    if (payment.method === 'barion') {
      const state = await getBarionPaymentState(payment.providerPaymentId);
      if (state.Status === 'Succeeded' && payment.status !== 'Succeeded') {
        await markPaymentSucceeded(payment);
      } else if ((state.Status === 'Expired' || state.Status === 'Canceled') && payment.status !== 'Expired') {
        payment.status = state.Status === 'Canceled' ? 'Canceled' : 'Expired';
        await payment.save();
      }
    } else {
      const session = await retrieveCheckoutSession(payment.providerPaymentId);
      if (session.payment_status === 'paid' && payment.status !== 'Succeeded') {
        await markPaymentSucceeded(payment);
      } else if (session.status === 'expired' && payment.status !== 'Expired') {
        payment.status = 'Expired';
        await payment.save();
      }
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

// Barion's own bank-transfer withdrawal fee: 0.1% of the amount, or 70 Ft,
// whichever is bigger - the whole point of the withdrawal feature is that
// this is far cheaper than any other way to move the club's collected
// money to a real bank account, so it's shown to the admin up front the
// same way the payer-facing BARION_FEE_RATE is (see members.ts/payment.ts).
const WITHDRAWAL_FEE_RATE = 0.001;
const WITHDRAWAL_MIN_FEE = 70;

function withdrawalWalletConfigFor(purpose) {
  return purpose === 'membershipFee' ? config.barion.membership : config.barion.tour;
}

function isWithdrawalConfigured(wallet) {
  return !!(wallet.walletKey && wallet.withdrawName && wallet.withdrawIban);
}

// GET /payments/withdraw/:purpose - requireAuth, restrictTo('admin'). Lets
// the Klub finance page show each wallet's withdraw button as inactive
// until its own BARION_..._WALLET_KEY/WITHDRAW_NAME/WITHDRAW_IBAN are all
// actually set (see config.js's own comment) - both wallets started out
// unconfigured, since the withdrawal feature only makes sense once real,
// live (non-sandbox) Barion wallets exist to hold real money.
export const getWithdrawalStatus = async (req, res) => {
  const purpose = req.params.purpose === 'membershipFee' ? 'membershipFee' : 'tourAdvance';
  const configured = isWithdrawalConfigured(withdrawalWalletConfigFor(purpose));
  res.status(200).json({ status: 'success', data: { configured } });
};

// POST /payments/withdraw - requireAuth, restrictTo('admin'). Pulls real
// money out of one of the two Barion wallets (see config.js's
// barion.membership/.tour) into that wallet's own fixed, preconfigured
// bank account via Barion's /v3/Withdraw/BankTransfer - authenticated with
// that specific wallet's own API key, never the shop's posKey (see
// utils/barion.js's createBarionWithdrawal). The destination account is
// deliberately not taken from the request at all (see the wallet config's
// own comment) - an admin can only pick which wallet and how much, never
// where the money actually goes, so a compromised admin session can't be
// used to redirect a withdrawal to an arbitrary account.
export const withdrawFunds = async (req, res) => {
  const purpose = req.body.purpose === 'membershipFee' ? 'membershipFee' : 'tourAdvance';
  const wallet = withdrawalWalletConfigFor(purpose);
  if (!isWithdrawalConfigured(wallet)) {
    throw new AppError('Ehhez a számlához még nincs beállítva a kiutalás.', 400);
  }

  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError('Érvénytelen összeg.', 400);
  }

  const fee = Math.max(Math.round(amount * WITHDRAWAL_FEE_RATE), WITHDRAWAL_MIN_FEE);
  const net = amount - fee;

  let result;
  try {
    result = await createBarionWithdrawal({
      walletKey: wallet.walletKey,
      amount,
      recipientName: wallet.withdrawName,
      iban: wallet.withdrawIban,
    });
  } catch (err) {
    logger.error(`Withdrawal failed for ${purpose}: ${err.message}`);
    throw new AppError('Nem sikerült elindítani a kiutalást.', 502);
  }

  logger.info(
    `Withdrawal started by admin ${req.user._id} for ${purpose}: ${amount} HUF requested, ${fee} HUF fee, ${net} HUF net, Barion TransactionId ${result.TransactionId ?? 'n/a'}`,
  );

  res.status(200).json({ status: 'success', data: { fee, net } });
};
