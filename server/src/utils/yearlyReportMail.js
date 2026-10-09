import logger from '../logger.js';
import User from '../models/userModel.js';
import ClubSettings from '../models/clubSettingsModel.js';
import sendResendEmail from './resendEmail.js';
import { escapeHtml } from './mailHtml.js';
import { getClubSettings } from './clubSettings.js';
import { budapestParts } from './huDate.js';
import { yearOnto, yearlyReportPdf } from './yearlyReport.js';

// "Éves jelentés" by e-mail: last year's report (utils/yearlyReport.js) to
// every club member on 1 January, by itself, once. Checked regularly by
// the live server (see server.js) - it only reads the database and sends
// e-mails.

// How long after 1 January a server that was down that day still sends it.
const LAST_DAY = 7;

// The year the next automatic e-mail is about: the one running now - it
// goes out on the coming 1 January.
export function reportYearToSend(now = new Date()) {
  return budapestParts(now).year;
}

export const yearlyReportFilename = (year) => `bodorgo-eves-jelentes-${year}.pdf`;

// Who gets it: every club member (admin or member, not suspended) with an
// e-mail address, except those who switched the app's e-mails off on
// Profilom.
export async function yearlyReportRecipients() {
  const members = await User.find({
    role: { $in: ['admin', 'member'] },
    retired: { $ne: true },
    email: { $nin: [null, ''] },
    wantsEmailNotifications: { $ne: false },
  }).select('name email');
  return members.sort((a, b) => a.name.localeCompare(b.name, 'hu'));
}

export function yearlyReportEmail(name, year) {
  const subject = `Bódorgó éves jelentés – ${year}`;
  const lines = [
    `Megjött a Bódorgó Klub ${year}. évi jelentése: tagság, kassza, táborok – egyetlen oldalon, a mellékletben.`,
    'A számok pontosak. A viccekért nem vállalunk felelősséget.',
    `Jó bódorgást ${yearOnto(year + 1)} is!`,
  ];
  const text = `Szia ${name}!\n\n${lines.join('\n\n')}\n\nÜdvözlettel,\nA Bódorgó csapat 🏕️`;
  const html =
    `<p>Szia ${escapeHtml(name)}!</p>` +
    lines.map((line) => `<p>${line}</p>`).join('') +
    `<p>Üdvözlettel,<br>A Bódorgó csapat 🏕️</p>`;
  return { subject, text, html };
}

// Sends the report of `year` to every club member. Returns the names it
// went to.
export async function sendYearlyReport(year, now = new Date()) {
  const { pdf } = await yearlyReportPdf(year, now);
  const attachments = [{ filename: yearlyReportFilename(year), content: pdf }];
  const sent = [];
  for (const member of await yearlyReportRecipients()) {
    try {
      await sendResendEmail({
        to: member.email,
        ...yearlyReportEmail(member.name, year),
        attachments,
      });
      sent.push(member.name);
    } catch (err) {
      logger.error(`Yearly report to ${member.email} failed: ${err.message}`);
    }
  }
  logger.info(`Yearly report ${year}: ${sent.length} sent`);
  return sent;
}

// The regular check (see server.js): on 1 January (or, after a day the
// server was down, until the 7th), from 9 in the morning Budapest time,
// last year's report goes out - once.
export async function checkYearlyReport(now = new Date()) {
  const { year, month, day, hour } = budapestParts(now);
  if (month !== 1 || day > LAST_DAY || hour < 9) return null;
  const reportYear = year - 1;
  const settings = await getClubSettings();
  if ((settings.yearlyReportSentYear ?? 0) >= reportYear) return null;
  // Marked first, so a restart halfway can't send it twice.
  await ClubSettings.updateOne({ key: 'club' }, { yearlyReportSentYear: reportYear });
  return { year: reportYear, sent: await sendYearlyReport(reportYear, now) };
}
