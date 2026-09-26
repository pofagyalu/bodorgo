import mongoose from 'mongoose';
import Tour from '../models/tourModel.js';
import Reservation from '../models/reservationModel.js';
import TourMailing from '../models/tourMailingModel.js';
import AppError from '../utils/appError.js';
import sendResendEmail from '../utils/resendEmail.js';
import { resolveDistanceInfo } from '../utils/distance.js';
import { cleanMailHtml, escapeHtml, isBlankMailHtml, mailHtmlToText } from '../utils/mailHtml.js';
import {
  partitionAttendeesByEmailEligibility,
  renderTourPdfToBuffer,
} from './tourPdfController.js';
import logger from '../logger.js';

// Letters to a tour's attendees, written by an admin on the tour page:
// one draft per tour, saved as it's typed, then mass-mailed to every
// attendee who can receive e-mail - optionally with each one's own
// Programfüzet attached. Sent letters are kept, unchanged, as the record
// of what went out. All admin-only (see tourRoutes.js).

async function findTour(idParam) {
  const query = mongoose.isValidObjectId(idParam) ? { _id: idParam } : { slug: idParam };
  const tour = await Tour.findOne(query);
  if (!tour) throw new AppError('No tour found with that ID!', 404);
  return tour;
}

const defaultSubject = (tour) => `${tour.order ? `${tour.order}. ` : ''}Bódorgó – ${tour.title}`;
const pdfFilename = (tour) => `${tour.order ? tour.order + '-' : ''}${tour.slug || 'tabor'}.pdf`;

// Everyone registered for the tour, once each, split into who can get an
// e-mail and who can't (with the reason) - same rules as the Programfüzet
// mass send (see tourPdfController.js's partitionAttendeesByEmailEligibility).
async function attendeeRecipients(tour) {
  const reservations = await Reservation.find({ tour: tour._id }).populate({
    path: 'attendees.user',
    select: 'name username email lastLoginAt wantsEmailNotifications location address',
  });
  const byId = new Map();
  for (const r of reservations) {
    for (const a of r.attendees) {
      if (a.user && !byId.has(String(a.user._id))) byId.set(String(a.user._id), a.user);
    }
  }
  return partitionAttendeesByEmailEligibility([...byId.values()]);
}

// The e-mail itself: the greeting, the admin's letter, a line about the
// attachment when there is one, and the usual closing.
function letterEmail(recipientName, letterHtml, withPdf, tourTitle) {
  const noReplyNote =
    'Erre az e-mailre kérjük, ne válaszolj - ez egy automatikusan generált üzenet.';
  const pdfLine = withPdf ? `Csatolva küldjük a(z) "${tourTitle}" tábor programfüzetét.` : '';
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222;">` +
    `<p>Szia ${escapeHtml(recipientName)}!</p>` +
    letterHtml +
    (pdfLine ? `<p>${escapeHtml(pdfLine)}</p>` : '') +
    `<p>Üdvözlettel,<br>Bódorgó</p>` +
    `<p style="color:#888;font-size:0.85em;">${noReplyNote}</p>` +
    `</div>`;
  const text = [
    `Szia ${recipientName}!`,
    mailHtmlToText(letterHtml),
    pdfLine,
    'Üdvözlettel,\nBódorgó',
    noReplyNote,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { html, text };
}

async function sendLetter(tour, user, { subject, html, withPdf }) {
  const { html: body, text } = letterEmail(user.name, html, withPdf, tour.title);
  const attachments = [];
  if (withPdf) {
    const distanceInfo = await resolveDistanceInfo(tour, user);
    attachments.push({
      filename: pdfFilename(tour),
      content: await renderTourPdfToBuffer(tour, user, distanceInfo),
    });
  }
  await sendResendEmail({ to: user.email, subject, text, html: body, attachments });
}

const publicMailing = (m) => ({
  _id: m._id,
  subject: m.subject,
  html: m.html,
  withPdf: m.withPdf,
  sentAt: m.sentAt,
  sentByName: m.sentByName,
  recipientCount: m.recipients?.length ?? 0,
  skipped: m.skipped ?? [],
});

// GET /tours/:id/mailings - the draft (if any), the sent letters, who
// would receive the next one, and the suggested defaults.
export const getMailings = async (req, res) => {
  const tour = await findTour(req.params.id);
  const [draft, sent, { eligible, skipped }] = await Promise.all([
    TourMailing.findOne({ tour: tour._id, status: 'draft' }),
    TourMailing.find({ tour: tour._id, status: 'sent' }).sort('-sentAt'),
    attendeeRecipients(tour),
  ]);
  res.status(200).json({
    status: 'success',
    data: {
      draft: draft
        ? {
            subject: draft.subject,
            html: draft.html,
            delta: draft.delta,
            updatedAt: draft.updatedAt,
          }
        : null,
      sent: sent.map(publicMailing),
      recipients: { eligible: eligible.map((u) => u.name), skipped },
      defaults: {
        subject: defaultSubject(tour),
        // The Programfüzet goes along by default until it has once.
        withPdf: !sent.some((m) => m.withPdf),
      },
    },
  });
};

// PUT /tours/:id/mailings/draft - saved as the admin types.
export const saveDraft = async (req, res) => {
  const tour = await findTour(req.params.id);
  const { subject, html, delta } = req.body ?? {};
  const draft = await TourMailing.findOneAndUpdate(
    { tour: tour._id, status: 'draft' },
    {
      subject: String(subject ?? '').slice(0, 200),
      html: cleanMailHtml(html),
      delta: delta ?? null,
      updatedByName: req.user.name,
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  res.status(200).json({ status: 'success', data: { updatedAt: draft.updatedAt } });
};

// Uses the saved draft - what the admin last saw saved is exactly what
// goes out.
async function savedDraft(tour) {
  const draft = await TourMailing.findOne({ tour: tour._id, status: 'draft' });
  if (!draft || isBlankMailHtml(draft.html)) {
    throw new AppError('A levél még üres - írj bele valamit a küldés előtt.', 400);
  }
  return draft;
}

// POST /tours/:id/mailings/test - the draft to the admin themselves only.
export const sendTest = async (req, res) => {
  const tour = await findTour(req.params.id);
  if (!req.user.email) throw new AppError('A fiókodhoz nincs e-mail cím rendelve.', 400);
  const draft = await savedDraft(tour);
  await sendLetter(tour, req.user, {
    subject: `[Próba] ${draft.subject || defaultSubject(tour)}`,
    html: draft.html,
    withPdf: !!req.body?.withPdf,
  });
  res.status(200).json({ status: 'success', data: { sentTo: req.user.email } });
};

// POST /tours/:id/mailings/send - the draft to every attendee who can get
// an e-mail. The draft then becomes a sent letter: kept, never edited.
export const sendToAttendees = async (req, res) => {
  const tour = await findTour(req.params.id);
  const draft = await savedDraft(tour);
  const withPdf = !!req.body?.withPdf;
  const subject = draft.subject || defaultSubject(tour);
  const { eligible, skipped } = await attendeeRecipients(tour);
  if (!eligible.length)
    throw new AppError('Nincs olyan résztvevő, akinek e-mailt lehetne küldeni.', 400);

  // Marked sent before the e-mails go out, so a second click can't send
  // it twice.
  draft.status = 'sent';
  draft.subject = subject;
  draft.withPdf = withPdf;
  draft.sentAt = new Date();
  draft.sentByName = req.user.name;
  draft.recipients = [];
  draft.skipped = skipped;
  await draft.save();

  const failed = [];
  for (const user of eligible) {
    try {
      await sendLetter(tour, user, { subject, html: draft.html, withPdf });
      draft.recipients.push({ name: user.name, email: user.email });
    } catch (err) {
      logger.error(`Tour ${tour._id}: letter to ${user.email} failed: ${err.message}`);
      failed.push({ name: user.name, reason: 'a küldés nem sikerült' });
    }
  }
  draft.skipped = [...skipped, ...failed];
  await draft.save();

  res.status(200).json({ status: 'success', data: { mailing: publicMailing(draft) } });
};
