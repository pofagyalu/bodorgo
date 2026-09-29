import config from '../config.js';
import logger from '../logger.js';
import User from '../models/userModel.js';
import Transaction from '../models/transactionModel.js';
import ClubSettings from '../models/clubSettingsModel.js';
import sendResendEmail from './resendEmail.js';
import { escapeHtml } from './mailHtml.js';
import { getClubSettings, membershipFeeForYear } from './clubSettings.js';
import { budapestParts, budapestYmd } from './huDate.js';

// "Tagdíj emlékeztető": members who haven't paid this year's fee get an
// e-mail on the rounds an admin set on Klub → Beállítások (a first date,
// then monthly or quarterly until the year's end), and the admins a
// summary of who got one. Checked regularly by the live server (see
// server.js) - it only reads the database and sends e-mails.

// Today's date in Budapest, "YYYY-MM-DD" - the rounds are calendar days
// there, whatever the server's own time zone.
// (Not the 'sv-SE' formatting trick: the live server's Node has only
// English locale data - see utils/huDate.js.)
export function budapestDate(now = new Date()) {
  return budapestYmd(now);
}

function budapestHour(now = new Date()) {
  return budapestParts(now).hour;
}

// A year's rounds, "YYYY-MM-DD": the start date, then every month or every
// 3 months, as long as it's still in the year (1 March quarterly: 03-01,
// 06-01, 09-01, 12-01).
export function reminderDates({ startMonth, startDay, frequency }, year) {
  const step = frequency === 'monthly' ? 1 : 3;
  const dates = [];
  for (let month = startMonth; month <= 12; month += step) {
    dates.push(`${year}-${String(month).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`);
  }
  return dates;
}

// The round due today, if any: the latest one that has come (a server
// that was down on the day sends it once, a day late) and hasn't been sent.
export function dueRound(reminder, today) {
  const year = Number(today.slice(0, 4));
  const passed = reminderDates(reminder, year).filter((d) => d <= today);
  const latest = passed.at(-1);
  if (!latest) return null;
  return !reminder.lastRoundSent || reminder.lastRoundSent < latest ? latest : null;
}

// Who gets one for `year`: club members (admin or member, not suspended)
// who had joined by then, have logged in at least once (so they have a
// real, working address), and have no dues payment recorded for the year.
export async function unpaidMembers(year) {
  const members = await User.find({
    role: { $in: ['admin', 'member'] },
    retired: { $ne: true },
    lastLoginAt: { $ne: null },
    email: { $nin: [null, ''] },
    $or: [{ memberSince: null }, { memberSince: { $lte: year } }],
  }).select('name email');
  const paid = new Set(
    (
      await Transaction.distinct('user', {
        type: 'income',
        category: 'Tagdíj',
        membershipYear: year,
      })
    ).map(String),
  );
  return members
    .filter((m) => !paid.has(String(m._id)))
    .sort((a, b) => a.name.localeCompare(b.name, 'hu'));
}

const paymentPageUrl = () =>
  `${(config.oridzs.clientBaseUrl || '').replace(/\/$/, '')}/klub/felhasznalok`;

const forint = (n) => new Intl.NumberFormat('hu-HU').format(n);

export function reminderEmail(name, year, fee) {
  const url = paymentPageUrl();
  const amount = fee ? ` (${forint(fee)} Ft)` : '';
  const subject = `Tagdíj emlékeztető – ${year}`;
  const text =
    `Szia ${name}!\n\n` +
    `A ${year}. évi tagdíjad${amount} még nincs befizetve. ` +
    `A Klub → Felhasználók oldalon tudod befizetni:\n${url}\n\n` +
    `Ha közben már befizetted, köszönjük, és tekintsd tárgytalannak ezt a levelet.\n\n` +
    `Üdvözlettel,\nA Bódorgó csapat 🏕️`;
  const html =
    `<p>Szia ${escapeHtml(name)}!</p>` +
    `<p>A ${year}. évi tagdíjad${amount} még nincs befizetve. ` +
    `A <a href="${url}">Klub → Felhasználók</a> oldalon tudod befizetni.</p>` +
    `<p>Ha közben már befizetted, köszönjük, és tekintsd tárgytalannak ezt a levelet.</p>` +
    `<p>Üdvözlettel,<br>A Bódorgó csapat 🏕️</p>`;
  return { subject, text, html };
}

function summaryEmail(year, round, names) {
  const subject = `Tagdíj emlékeztető kiment – ${names.length} tag`;
  const list = names.length ? names.map((n) => `- ${n}`).join('\n') : '(senki - mindenki fizetett)';
  const text = `A ${round} körben ${names.length} tag kapott emlékeztetőt a ${year}. évi tagdíjról:\n\n${list}`;
  const html =
    `<p>A ${round} körben ${names.length} tag kapott emlékeztetőt a ${year}. évi tagdíjról:</p>` +
    (names.length
      ? `<ul>${names.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`
      : '<p>(senki – mindenki fizetett)</p>');
  return { subject, text, html };
}

// Sends one round: a reminder to each unpaid member, then the summary to
// every admin. Returns the names reminded.
export async function sendReminderRound(round) {
  const year = Number(round.slice(0, 4));
  const fee = await membershipFeeForYear(year);
  const sent = [];
  for (const member of await unpaidMembers(year)) {
    try {
      await sendResendEmail({ to: member.email, ...reminderEmail(member.name, year, fee) });
      sent.push(member.name);
    } catch (err) {
      logger.error(`Membership reminder to ${member.email} failed: ${err.message}`);
    }
  }
  const admins = await User.find({ role: 'admin', email: { $nin: [null, ''] } }).select('email');
  for (const admin of admins) {
    try {
      await sendResendEmail({ to: admin.email, ...summaryEmail(year, round, sent) });
    } catch (err) {
      logger.error(`Membership reminder summary to ${admin.email} failed: ${err.message}`);
    }
  }
  logger.info(`Membership reminders (${round}): ${sent.length} sent`);
  return sent;
}

// The regular check (see server.js): sends today's round if one is due -
// only from 9 in the morning, Budapest time, so nobody gets it at night.
export async function checkMembershipReminders(now = new Date()) {
  const settings = await getClubSettings();
  const reminder = settings.membershipReminder;
  if (!reminder?.enabled || budapestHour(now) < 9) return null;
  const round = dueRound(reminder, budapestDate(now));
  if (!round) return null;
  // Marked first, so a restart halfway can't send the round twice.
  await ClubSettings.updateOne({ key: 'club' }, { 'membershipReminder.lastRoundSent': round });
  return { round, sent: await sendReminderRound(round) };
}

// "Minden klubtag befizette a(z) N. évi tagdíjat" - to the admins once the
// year's dues are all in: every club member (admin or member, not
// suspended) who was a member that year has a dues payment for it. Checked
// after each dues payment (see paymentController.js); sent once a year.
export async function notifyAdminsIfAllMembersPaid(year = new Date().getFullYear()) {
  const settings = await getClubSettings();
  if (settings.allPaidNotifiedYear === year) return false;

  const members = await User.find({
    role: { $in: ['admin', 'member'] },
    retired: { $ne: true },
    $or: [{ memberSince: null }, { memberSince: { $lte: year } }],
  }).select('_id');
  if (!members.length) return false;
  const paid = new Set(
    (
      await Transaction.distinct('user', {
        type: 'income',
        category: 'Tagdíj',
        membershipYear: year,
      })
    ).map(String),
  );
  if (!members.every((m) => paid.has(String(m._id)))) return false;

  // Marked first, so it can't go out twice.
  await ClubSettings.updateOne({ key: 'club' }, { allPaidNotifiedYear: year });
  const admins = await User.find({ role: 'admin', email: { $nin: [null, ''] } }).select('email');
  if (!admins.length) return true;
  await sendResendEmail({
    to: admins.map((a) => a.email),
    subject: `Minden klubtag befizette a(z) ${year}. évi tagdíjat`,
    text: `Minden klubtag (${members.length} fő) befizette a(z) ${year}. évi tagdíjat.`,
    html: `<p>Minden klubtag (${members.length} fő) befizette a(z) <strong>${year}</strong>. évi tagdíjat.</p>`,
  });
  return true;
}
