import config from '../config.js';
import logger from '../logger.js';
import User from '../models/userModel.js';
import sendResendEmail from './resendEmail.js';
import { escapeHtml, mailHtmlToText } from './mailHtml.js';
import { huDateTime } from './huDate.js';

// "Új szavazás" e-mail: an admin creating a poll on the Voks page may
// send it to club members they pick (see pollController.js's createPoll).

// Why a club member can't get it - or null when they can. Logged in or
// not doesn't matter (the letter's link takes them to the login), but
// the e-mails turned off on Profilom are respected: this isn't mandatory
// like the dues reminder.
function whyNoEmail(user) {
  if (!user.email) return 'nincs e-mail cím';
  if (user.wantsEmailNotifications === false) return 'kikapcsolta az e-mail értesítéseket';
  return null;
}

// Club members (admin or member, not suspended) by name, each with
// whether they can get the e-mail - the Voks form's recipient list.
export async function pollEmailCandidates() {
  const users = await User.find({ role: { $in: ['admin', 'member'] }, retired: { $ne: true } })
    .select('name email wantsEmailNotifications')
    .lean();
  return users
    .map((u) => {
      const reason = whyNoEmail(u);
      return { _id: String(u._id), name: u.name, canEmail: !reason, reason };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'hu'));
}

const votePageUrl = () => `${(config.clientBaseUrl || '').replace(/\/$/, '')}/szavazasok`;

// The letter: the question, its details, the answers, when it closes, and
// a button to the Voks page.
export function pollEmail(name, poll, tourTitle) {
  const url = votePageUrl();
  const closes = huDateTime(poll.closesAt);
  const where = tourTitle ? ` (${tourTitle})` : '';
  const options = poll.options.map((o) => o.text);
  const noReplyNote =
    'Erre az e-mailre kérjük, ne válaszolj - ez egy automatikusan generált üzenet.';
  const subject = `Új szavazás: ${poll.question}`;
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222;">` +
    `<p>Szia ${escapeHtml(name)}!</p>` +
    `<p>Új szavazás indult${escapeHtml(where)}:</p>` +
    `<p style="font-size:18px;font-weight:bold;margin:0 0 12px;">${escapeHtml(poll.question)}</p>` +
    (poll.details || '') +
    `<ul>${options.map((o) => `<li>${escapeHtml(o)}</li>`).join('')}</ul>` +
    `<p>A szavazás <strong>${escapeHtml(closes)}</strong>-kor zárul.</p>` +
    `<p><a href="${url}" style="display:inline-block;background:#1a796c;color:#fff;` +
    `text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:bold;">Szavazok</a></p>` +
    `<p>Üdvözlettel,<br>Bódorgó</p>` +
    `<p style="color:#888;font-size:0.85em;">${noReplyNote}</p>` +
    `</div>`;
  const text = [
    `Szia ${name}!`,
    `Új szavazás indult${where}:`,
    poll.question,
    poll.details ? mailHtmlToText(poll.details) : '',
    options.map((o) => `- ${o}`).join('\n'),
    `A szavazás ${closes}-kor zárul.`,
    `Szavazni itt tudsz: ${url}`,
    'Üdvözlettel,\nBódorgó',
    noReplyNote,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { subject, html, text };
}

// The chosen ones who can get it: unknown ids, non-members and those who
// can't get e-mail are dropped (the form only offers the rest anyway).
export async function pollEmailRecipients(userIds) {
  const chosen = new Set((Array.isArray(userIds) ? userIds : []).map(String));
  if (!chosen.size) return [];
  const users = await User.find({ role: { $in: ['admin', 'member'] }, retired: { $ne: true } })
    .select('name email wantsEmailNotifications')
    .lean();
  return users.filter((u) => chosen.has(String(u._id)) && !whyNoEmail(u));
}

// One letter each, one after the other. Returns how many went out.
export async function sendPollEmails(poll, recipients, tourTitle) {
  let sent = 0;
  for (const user of recipients) {
    try {
      await sendResendEmail({ to: user.email, ...pollEmail(user.name, poll, tourTitle) });
      sent += 1;
    } catch (err) {
      logger.error(`Poll ${poll._id}: e-mail to ${user.email} failed: ${err.message}`);
    }
  }
  logger.info(`Poll ${poll._id}: e-mail sent to ${sent} of ${recipients.length}`);
  return sent;
}
