import Transaction from '../models/transactionModel.js';
import AppError from '../utils/appError.js';
import {
  CLUB_FOUNDING_YEAR,
  PAYMENT_METHOD_NAMES,
  feeForYear,
  getClubSettings,
  membershipFeeForYear,
  paymentMethodView,
} from '../utils/clubSettings.js';
import {
  budapestDate,
  reminderDates,
  reminderEmail,
  unpaidMembers,
} from '../utils/membershipReminders.js';
import sendResendEmail from '../utils/resendEmail.js';
import User from '../models/userModel.js';
import logger from '../logger.js';
import { chatImagesUsage, enforceChatImageQuota } from '../chat/chatImages.js';
import { clearImageCache, enforceImageCacheQuota, imageCacheUsage } from '../photos/imageSizes.js';
import { BIRTHDAY_EFFECTS, DEFAULT_BIRTHDAY_MESSAGE } from '../utils/birthday.js';
import { DEFAULT_RANK_MESSAGE } from '../utils/ranks.js';
import { yearlyReportPdf } from '../utils/yearlyReport.js';
import {
  reportYearToSend,
  yearlyReportEmail,
  yearlyReportFilename,
  yearlyReportRecipients,
} from '../utils/yearlyReportMail.js';
import { waxSealPng } from '../utils/waxSeal.js';
import { stripeAccountReady } from '../utils/stripe.js';
import config from '../config.js';
import crypto from 'crypto';
import ClubSettings from '../models/clubSettingsModel.js';
import {
  AUTHENTIK,
  DEFAULT_INVITATION_FLOW,
  authentikProvider,
  discover,
  getOidcSettings,
  getOtherProviders,
  issuerUrl,
  storedOidc,
  trimUrl,
} from '../utils/oidcSettings.js';
import { canEncrypt, encryptSecret } from '../utils/secretBox.js';

// Klub → Beállítások: club-wide settings. For now the yearly membership
// fee, by the year each amount takes effect (see utils/clubSettings.js).

// The years somebody has already paid their dues for - their fee is
// history now and can't be changed.
async function paidYears() {
  return (await Transaction.distinct('membershipYear', { type: 'income', category: 'Tagdíj' }))
    .filter((y) => Number.isInteger(y))
    .sort((a, b) => a - b);
}

const formatFees = (fees) =>
  [...fees]
    .sort((a, b) => a.fromYear - b.fromYear)
    .map((f) => `${f.fromYear}-től ${f.amount} Ft`)
    .join(', ');

// GET /settings/membership-fees - members see the fees (the Felhasználók
// page's pay dialog uses them) and the payment deadline (Klub →
// Áttekintés shows it): the day of the year's first Tagdíj emlékeztető.
// Admins also get which years are already paid for (locked). Who changed
// the fees when is on Klub → Napló (auditLogController.js), with every
// other change of the settings.
export const getMembershipFees = async (req, res) => {
  const settings = await getClubSettings();
  const isAdmin = req.user.role === 'admin';
  res.status(200).json({
    status: 'success',
    data: {
      fees: [...settings.membershipFees].sort((a, b) => a.fromYear - b.fromYear),
      foundingYear: CLUB_FOUNDING_YEAR,
      paymentDeadline: {
        month: settings.membershipReminder.startMonth,
        day: settings.membershipReminder.startDay,
      },
      ...(isAdmin ? { paidYears: await paidYears() } : {}),
    },
  });
};

// PUT /settings/membership-fees - admin-only. Replaces the whole table
// ({ fees: [{ fromYear, amount }] }), after checking it: whole years and
// forints, no year twice, the founding year covered, and no change to the
// fee of a year somebody has already paid for.
export const updateMembershipFees = async (req, res) => {
  const rows = Array.isArray(req.body?.fees) ? req.body.fees : null;
  if (!rows || rows.length === 0 || rows.length > 30) {
    throw new AppError('Adj meg legalább egy tagdíj sort.', 400);
  }

  const maxYear = new Date().getFullYear() + 10;
  const fees = rows.map((r) => ({ fromYear: Number(r?.fromYear), amount: Number(r?.amount) }));
  for (const f of fees) {
    if (!Number.isInteger(f.fromYear) || f.fromYear < CLUB_FOUNDING_YEAR || f.fromYear > maxYear) {
      throw new AppError(`Az év ${CLUB_FOUNDING_YEAR} és ${maxYear} között lehet.`, 400);
    }
    if (!Number.isInteger(f.amount) || f.amount < 1 || f.amount > 1000000) {
      throw new AppError('Az összeg 1 és 1 000 000 Ft közötti egész szám lehet.', 400);
    }
  }
  if (new Set(fees.map((f) => f.fromYear)).size !== fees.length) {
    throw new AppError('Egy évhez csak egy sor tartozhat.', 400);
  }
  if (!fees.some((f) => f.fromYear === CLUB_FOUNDING_YEAR)) {
    throw new AppError(
      `Kell egy sor ${CLUB_FOUNDING_YEAR}-től, hogy minden évnek legyen díja.`,
      400,
    );
  }

  const settings = await getClubSettings();
  const changedPaidYears = (await paidYears()).filter(
    (y) => feeForYear(settings.membershipFees, y) !== feeForYear(fees, y),
  );
  if (changedPaidYears.length) {
    throw new AppError(
      `Erre az évre már van befizetett tagdíj, ezért a díja nem változhat: ${changedPaidYears.join(', ')}.`,
      400,
    );
  }

  const before = formatFees(settings.membershipFees);
  settings.membershipFees = fees.sort((a, b) => a.fromYear - b.fromYear);
  const after = formatFees(settings.membershipFees);
  if (before !== after) {
    settings.history.push({
      at: new Date(),
      byName: req.user.name,
      change: `Tagdíj: ${before} → ${after}`,
    });
  }
  await settings.save();

  res.status(200).json({ status: 'success', data: { fees: settings.membershipFees } });
};

// --- Tagdíj emlékeztető (see utils/membershipReminders.js) ---

const FREQUENCY_LABEL = { monthly: 'havonta', quarterly: 'negyedévente' };

function reminderView(reminder, today = budapestDate()) {
  const year = Number(today.slice(0, 4));
  const dates = reminderDates(reminder, year);
  // The next round that hasn't gone out - this year's, or next year's first.
  const next =
    dates.find((d) => !reminder.lastRoundSent || d > reminder.lastRoundSent) ??
    reminderDates(reminder, year + 1)[0];
  return {
    enabled: reminder.enabled,
    startMonth: reminder.startMonth,
    startDay: reminder.startDay,
    frequency: reminder.frequency,
    lastRoundSent: reminder.lastRoundSent ?? null,
    dates,
    nextRound: reminder.enabled ? next : null,
  };
}

// GET /settings/membership-reminder (admin) - the settings, this year's
// rounds, and who would get one now (unpaid for this year).
export const getMembershipReminder = async (req, res) => {
  const settings = await getClubSettings();
  const year = new Date().getFullYear();
  const recipients = await unpaidMembers(year);
  res.status(200).json({
    status: 'success',
    data: {
      reminder: reminderView(settings.membershipReminder),
      year,
      recipients: recipients.map((m) => m.name),
    },
  });
};

// PUT /settings/membership-reminder (admin) - { enabled, startMonth,
// startDay, frequency }. Switching it on, or changing the schedule, counts
// the rounds already past as done - the first e-mails go out on the next
// date, not the moment it's saved.
export const updateMembershipReminder = async (req, res) => {
  const enabled = !!req.body?.enabled;
  const startMonth = Number(req.body?.startMonth);
  const startDay = Number(req.body?.startDay);
  const frequency = req.body?.frequency;
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new AppError('A hónap 1 és 12 között lehet.', 400);
  }
  if (!Number.isInteger(startDay) || startDay < 1 || startDay > 28) {
    throw new AppError('A nap 1 és 28 között lehet (minden hónapban létezzen).', 400);
  }
  if (!['monthly', 'quarterly'].includes(frequency)) {
    throw new AppError('A gyakoriság havonta vagy negyedévente lehet.', 400);
  }

  const settings = await getClubSettings();
  // A plain copy: assigning below updates the same Mongoose object in place.
  const old = settings.membershipReminder.toObject();
  const scheduleChanged =
    old.startMonth !== startMonth || old.startDay !== startDay || old.frequency !== frequency;
  const next = { enabled, startMonth, startDay, frequency, lastRoundSent: old.lastRoundSent };
  if (enabled && (!old.enabled || scheduleChanged)) {
    const today = budapestDate();
    const passed = reminderDates(next, Number(today.slice(0, 4))).filter((d) => d <= today);
    next.lastRoundSent = passed.at(-1) ?? old.lastRoundSent;
  }
  settings.membershipReminder = next;

  const describe = (r) =>
    r.enabled
      ? `bekapcsolva, ${r.startMonth}.${String(r.startDay).padStart(2, '0')}.-tól ${FREQUENCY_LABEL[r.frequency]}`
      : 'kikapcsolva';
  if (describe(old) !== describe(next)) {
    settings.history.push({
      at: new Date(),
      byName: req.user.name,
      change: `Tagdíj emlékeztető: ${describe(old)} → ${describe(next)}`,
    });
  }
  await settings.save();
  res.status(200).json({ status: 'success', data: { reminder: reminderView(next) } });
};

// POST /settings/membership-reminder/test (admin) - the reminder as a
// member would get it, to the admin themselves.
export const testMembershipReminder = async (req, res) => {
  if (!req.user.email) throw new AppError('Nincs e-mail címed a fiókodban.', 400);
  const year = new Date().getFullYear();
  const fee = await membershipFeeForYear(year);
  await sendResendEmail({ to: req.user.email, ...reminderEmail(req.user.name, year, fee) });
  res.status(200).json({ status: 'success', data: { sentTo: req.user.email } });
};

// --- Éves jelentés (see utils/yearlyReport.js, utils/yearlyReportMail.js) ---

// GET /settings/yearly-report (admin) - the year the next automatic
// e-mail is about, the 1 January it goes out on, who would get it now, and
// the last year already sent.
export const getYearlyReport = async (req, res) => {
  const settings = await getClubSettings();
  const year = reportYearToSend();
  const recipients = await yearlyReportRecipients();
  res.status(200).json({
    status: 'success',
    data: {
      year,
      sendsOn: `${year + 1}-01-01`,
      recipients: recipients.map((m) => m.name),
      lastSentYear: settings.yearlyReportSentYear ?? null,
    },
  });
};

// GET /settings/yearly-report/preview.pdf (admin) - that report as it
// stands today.
export const getYearlyReportPdf = async (req, res) => {
  const year = reportYearToSend();
  const { pdf } = await yearlyReportPdf(year);
  res
    .status(200)
    .set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${yearlyReportFilename(year)}"`,
      'Cache-Control': 'no-store',
    })
    .send(pdf);
};

// POST /settings/yearly-report/test (admin) - the e-mail as a member would
// get it, with the report as it stands today, to the admin themselves.
export const testYearlyReport = async (req, res) => {
  if (!req.user.email) throw new AppError('Nincs e-mail címed a fiókodban.', 400);
  const year = reportYearToSend();
  const { pdf } = await yearlyReportPdf(year);
  await sendResendEmail({
    to: req.user.email,
    ...yearlyReportEmail(req.user.name, year),
    attachments: [{ filename: yearlyReportFilename(year), content: pdf }],
  });
  res.status(200).json({ status: 'success', data: { sentTo: req.user.email, year } });
};

// --- Chat photos (see chat/chatImages.js) ---

// GET /settings/chat-images (admin) - the quota, the daily limit, and how
// much the photos take up now.
export const getChatImageSettings = async (req, res) => {
  const { chatImages } = await getClubSettings();
  res.status(200).json({
    status: 'success',
    data: {
      quotaMB: chatImages.quotaMB,
      dailyLimit: chatImages.dailyLimit,
      usage: await chatImagesUsage(),
    },
  });
};

// PUT /settings/chat-images (admin) - { quotaMB, dailyLimit }. A smaller
// quota takes effect right away: the oldest photos go until it fits.
export const updateChatImageSettings = async (req, res) => {
  const quotaMB = Number(req.body?.quotaMB);
  const dailyLimit = Number(req.body?.dailyLimit);
  if (!Number.isInteger(quotaMB) || quotaMB < 50 || quotaMB > 100000) {
    throw new AppError('A keret 50 és 100 000 MB között lehet.', 400);
  }
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 1000) {
    throw new AppError('A napi korlát 1 és 1000 között lehet.', 400);
  }
  const settings = await getClubSettings();
  const before = `${settings.chatImages.quotaMB} MB, napi ${settings.chatImages.dailyLimit}`;
  settings.chatImages = { quotaMB, dailyLimit };
  const after = `${quotaMB} MB, napi ${dailyLimit}`;
  if (before !== after) {
    settings.history.push({
      at: new Date(),
      byName: req.user.name,
      change: `Kotyogó fotók: ${before} → ${after}`,
    });
  }
  await settings.save();
  const removed = await enforceChatImageQuota();
  res.status(200).json({
    status: 'success',
    data: { quotaMB, dailyLimit, usage: await chatImagesUsage(), removed },
  });
};

// --- Kép gyorsítótár (see photos/imageSizes.js) ---

// GET /settings/image-cache (admin) - the quota and how much the smaller
// photo versions take up now.
export const getImageCacheSettings = async (req, res) => {
  const { imageCache } = await getClubSettings();
  res.status(200).json({
    status: 'success',
    data: { quotaMB: imageCache.quotaMB, usage: imageCacheUsage() },
  });
};

// PUT /settings/image-cache (admin) - { quotaMB }. A smaller quota takes
// effect right away: the least recently viewed go until it fits.
export const updateImageCacheSettings = async (req, res) => {
  const quotaMB = Number(req.body?.quotaMB);
  if (!Number.isInteger(quotaMB) || quotaMB < 100 || quotaMB > 1000000) {
    throw new AppError('A keret 100 és 1 000 000 MB között lehet.', 400);
  }
  const settings = await getClubSettings();
  const before = settings.imageCache.quotaMB;
  settings.imageCache = { quotaMB };
  if (before !== quotaMB) {
    settings.history.push({
      at: new Date(),
      byName: req.user.name,
      change: `Kép gyorsítótár: ${before} MB → ${quotaMB} MB`,
    });
  }
  await settings.save();
  const removed = await enforceImageCacheQuota();
  res.status(200).json({
    status: 'success',
    data: { quotaMB, usage: imageCacheUsage(), removed },
  });
};

// DELETE /settings/image-cache (admin) - Gyorsítótár ürítése: every
// version goes; they're made again as photos are viewed.
export const clearImageCacheNow = async (req, res) => {
  const removed = clearImageCache();
  const { imageCache } = await getClubSettings();
  res.status(200).json({
    status: 'success',
    data: { quotaMB: imageCache.quotaMB, usage: imageCacheUsage(), removed },
  });
};

// --- Barion wallets (Kiutalás Barionból) ---

const WALLETS = { membership: 'Tagdíjak', tour: 'Előlegek' };

// A Hungarian IBAN: HU + 26 digits, spaces allowed, and its check digits
// right (mod 97) - a typo can't send a withdrawal to a wrong account.
export function normalizeIban(value) {
  const iban = String(value ?? '')
    .replace(/\s+/g, '')
    .toUpperCase();
  if (!/^HU\d{26}$/.test(iban)) return null;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => c.charCodeAt(0) - 55);
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1 ? iban : null;
}

// "HU12 3456 7890 ..." - in groups of four, for reading.
const formatIban = (iban) => (iban ? iban.replace(/(.{4})(?=.)/g, '$1 ') : '');

// What the page shows of a wallet.
function walletView(wallet = {}) {
  return {
    payeeEmail: wallet.payeeEmail ?? '',
    withdrawName: wallet.withdrawName ?? '',
    withdrawIban: formatIban(wallet.withdrawIban),
  };
}

// GET /settings/barion (admin) - both wallets.
export const getBarionSettings = async (req, res) => {
  const { barion } = await getClubSettings();
  res.status(200).json({
    status: 'success',
    data: { membership: walletView(barion?.membership), tour: walletView(barion?.tour) },
  });
};

// PUT /settings/barion/:wallet (admin) - { payeeEmail, withdrawName,
// withdrawIban }.
// Where money goes is the most sensitive setting there is: each change is
// in the history, and every admin gets an e-mail about it (old -> new, who).
export const updateBarionWallet = async (req, res) => {
  const key = req.params.wallet;
  if (!WALLETS[key]) throw new AppError('Nincs ilyen számla.', 404);

  const payeeEmail = String(req.body?.payeeEmail ?? '').trim();
  const withdrawName = String(req.body?.withdrawName ?? '').trim();
  const withdrawIban = normalizeIban(req.body?.withdrawIban);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payeeEmail)) {
    throw new AppError('Adj meg egy érvényes Barion e-mail címet.', 400);
  }
  if (!withdrawName || withdrawName.length > 70) {
    throw new AppError('Add meg a számlatulajdonos nevét (legfeljebb 70 karakter).', 400);
  }
  if (!withdrawIban) {
    throw new AppError('Érvénytelen bankszámlaszám - magyar IBAN kell (HU + 26 számjegy).', 400);
  }

  const settings = await getClubSettings();
  const before = settings.barion?.[key]?.toObject?.() ?? {};
  const after = { payeeEmail, withdrawName, withdrawIban };

  const changes = [
    ['Barion e-mail', before.payeeEmail, after.payeeEmail],
    ['Számlatulajdonos', before.withdrawName, after.withdrawName],
    ['Bankszámla', formatIban(before.withdrawIban), formatIban(after.withdrawIban)],
  ]
    .filter(([, a, b]) => (a ?? '') !== b)
    .map(([label, a, b]) => `${label}: ${a || '(nincs)'} → ${b}`);

  if (changes.length) {
    settings.set(`barion.${key}`, after);
    settings.history.push({
      at: new Date(),
      byName: req.user.name,
      change: `Barion (${WALLETS[key]}): ${changes.join('; ')}`,
    });
    await settings.save();

    const admins = await User.find({ role: 'admin', email: { $nin: [null, ''] } }).select('email');
    if (admins.length) {
      const lines = changes.map((c) => `<li>${c}</li>`).join('');
      await sendResendEmail({
        to: admins.map((a) => a.email),
        subject: `Bódorgó: megváltozott a Barion beállítás (${WALLETS[key]})`,
        html: `<p>${req.user.name} megváltoztatta a(z) <strong>${WALLETS[key]}</strong> Barion-számla beállításait:</p><ul>${lines}</ul><p>Ha nem tudsz róla, azonnal nézd meg a Klub → Beállítások oldalon!</p>`,
        text: [
          `${req.user.name} megváltoztatta a(z) ${WALLETS[key]} Barion-számla beállításait:`,
          ...changes,
          '',
          'Ha nem tudsz róla, azonnal nézd meg a Klub → Beállítások oldalon!',
        ].join('\n'),
      }).catch((err) => logger.error(`Barion settings e-mail failed: ${err.message}`));
    }
  }

  res.status(200).json({ status: 'success', data: walletView(after) });
};

// --- Fizetési módok: the online gateways and the fee on top ---

const describeMethod = (m) =>
  `${m.enabled ? 'bekapcsolva' : 'kikapcsolva'}, díj: ${m.feePercent}% + ${m.feeFixed} Ft, legalább ${m.feeMin} Ft`;

// GET /settings/payment-methods - anyone logged in: the pay dialogs offer
// the ones switched on, and show each one's fee before paying. wallets:
// which purposes each can take now - Stripe only where that purpose's own
// account has its key (.env), so advances can wait for theirs.
export const getPaymentMethods = async (req, res) => {
  const { paymentMethods } = await getClubSettings();
  res.status(200).json({
    status: 'success',
    data: {
      stripe: {
        ...paymentMethodView(paymentMethods?.stripe),
        wallets: {
          membership: stripeAccountReady('membership'),
          tour: stripeAccountReady('tour'),
        },
      },
      barion: {
        ...paymentMethodView(paymentMethods?.barion),
        wallets: { membership: true, tour: true },
      },
    },
  });
};

// PUT /settings/payment-methods/:method (admin) - { enabled, feePercent,
// feeFixed, feeMin }: the fee the payer pays on top is feePercent % of the
// charge plus feeFixed Ft, at least feeMin Ft.
export const updatePaymentMethod = async (req, res) => {
  const key = req.params.method;
  if (!PAYMENT_METHOD_NAMES[key]) throw new AppError('Nincs ilyen fizetési mód.', 404);

  const enabled = req.body?.enabled === true;
  const feePercent = Number(req.body?.feePercent);
  const feeFixed = Number(req.body?.feeFixed);
  const feeMin = Number(req.body?.feeMin);
  if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > 20) {
    throw new AppError('A százalék 0 és 20 között lehet.', 400);
  }
  for (const amount of [feeFixed, feeMin]) {
    if (!Number.isInteger(amount) || amount < 0 || amount > 10000) {
      throw new AppError('A díj 0 és 10 000 Ft közötti egész szám lehet.', 400);
    }
  }

  const settings = await getClubSettings();
  const before = describeMethod(paymentMethodView(settings.paymentMethods?.[key]));
  const after = { enabled, feePercent, feeFixed, feeMin };
  if (before !== describeMethod(after)) {
    settings.set(`paymentMethods.${key}`, after);
    settings.history.push({
      at: new Date(),
      byName: req.user.name,
      change: `Fizetési mód (${PAYMENT_METHOD_NAMES[key]}): ${before} → ${describeMethod(after)}`,
    });
    await settings.save();
  }
  res.status(200).json({ status: 'success', data: after });
};

// --- Születésnap (see utils/birthday.js) ---

const EFFECT_NAMES = {
  confetti: 'Konfetti eső',
  fireworks: 'Tűzijáték',
  cannons: 'Oldalsó ágyúk',
  stars: 'Csillagszórás',
  snow: 'Lassú konfetti',
  emoji: 'Emoji eső',
};

const birthdayView = (b) => ({
  enabled: b?.enabled ?? true,
  effect: b?.effect ?? 'confetti',
  message: b?.message ?? DEFAULT_BIRTHDAY_MESSAGE,
});

// GET /settings/birthday (admin).
export const getBirthdaySettings = async (req, res) => {
  const { birthday } = await getClubSettings();
  res.status(200).json({ status: 'success', data: birthdayView(birthday) });
};

// PUT /settings/birthday (admin) - { enabled, effect, message }.
export const updateBirthdaySettings = async (req, res) => {
  const enabled = req.body?.enabled === true;
  const effect = req.body?.effect;
  const message = String(req.body?.message ?? '').trim();
  if (!BIRTHDAY_EFFECTS.includes(effect)) throw new AppError('Ismeretlen effekt.', 400);
  if (!message || message.length > 200) {
    throw new AppError('Az üzenet 1-200 karakter lehet.', 400);
  }
  const settings = await getClubSettings();
  const before = birthdayView(settings.birthday);
  const after = { enabled, effect, message };
  const changes = [
    before.enabled !== enabled && (enabled ? 'bekapcsolva' : 'kikapcsolva'),
    before.effect !== effect && `effekt: ${EFFECT_NAMES[before.effect]} → ${EFFECT_NAMES[effect]}`,
    before.message !== message && `üzenet: „${message}”`,
  ].filter(Boolean);
  if (changes.length) {
    settings.birthday = after;
    settings.history.push({
      at: new Date(),
      byName: req.user.name,
      change: `Születésnap: ${changes.join('; ')}`,
    });
    await settings.save();
  }
  res.status(200).json({ status: 'success', data: after });
};

// --- Rangok ünneplése (see utils/ranks.js) ---

const rankView = (r) => ({
  enabled: r?.enabled ?? true,
  effect: r?.effect ?? 'fireworks',
  message: r?.message ?? DEFAULT_RANK_MESSAGE,
});

// GET /settings/rank (admin).
export const getRankSettings = async (req, res) => {
  const { rankCelebration } = await getClubSettings();
  res.status(200).json({ status: 'success', data: rankView(rankCelebration) });
};

// PUT /settings/rank (admin) - { enabled, effect, message }.
export const updateRankSettings = async (req, res) => {
  const enabled = req.body?.enabled === true;
  const effect = req.body?.effect;
  const message = String(req.body?.message ?? '').trim();
  if (!BIRTHDAY_EFFECTS.includes(effect)) throw new AppError('Ismeretlen effekt.', 400);
  if (!message || message.length > 200) {
    throw new AppError('Az üzenet 1-200 karakter lehet.', 400);
  }
  const settings = await getClubSettings();
  const before = rankView(settings.rankCelebration);
  const after = { enabled, effect, message };
  const changes = [
    before.enabled !== enabled && (enabled ? 'bekapcsolva' : 'kikapcsolva'),
    before.effect !== effect && `effekt: ${EFFECT_NAMES[before.effect]} → ${EFFECT_NAMES[effect]}`,
    before.message !== message && `üzenet: „${message}”`,
  ].filter(Boolean);
  if (changes.length) {
    settings.rankCelebration = after;
    settings.history.push({
      at: new Date(),
      byName: req.user.name,
      change: `Rangok ünneplése: ${changes.join('; ')}`,
    });
    await settings.save();
  }
  res.status(200).json({ status: 'success', data: after });
};

// --- OIDC szolgáltató (see utils/oidcSettings.js) - the role manager only ---

const SLUG = /^[A-Za-z0-9_-]{1,100}$/;

const isWebAddress = (value) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

// What has to be listed among a provider's Redirect URIs - shown on the
// page as information, for setting the provider up: the callback of a
// server run on one's own machine, the live API's callback, and the live
// site (where a logout lands) - the club's own three, the same whichever
// server shows them. A server at another address adds its own callback.
const CLUB_REDIRECT_URIS = [
  'http://localhost:8235/auth/callback',
  'https://api.bodorgo.hu/auth/callback',
  'https://bodorgo.hu',
];

const redirectUrisFor = (req) => [
  ...new Set([
    ...CLUB_REDIRECT_URIS,
    ...[`${req.protocol}://${req.get('host')}`, trimUrl(config.apiBaseUrl)]
      .filter(Boolean)
      .map((base) => `${base}/auth/callback`),
  ]),
];

// What the page shows: never a secret, only whether there is one.
async function oidcView(req) {
  const s = await getOidcSettings();
  return {
    serverUrl: s.serverUrl,
    providerSlug: s.providerSlug,
    clientId: s.clientId,
    hasClientSecret: !!s.clientSecret,
    postLogoutRedirectUri: s.postLogoutRedirectUri,
    hasApiToken: !!s.apiToken,
    invitationFlow: s.invitationFlow,
    // Where they come from now: 'database' (saved here) or 'env'.
    source: s.source,
    // The saved secrets can't be read with this server's APP_SECRET_KEY.
    unreadable: !!s.unreadable,
    // APP_SECRET_KEY is set: the secrets can be saved.
    canSave: canEncrypt(),
    issuer: s.serverUrl && s.providerSlug ? issuerUrl(s) : '',
    // This server's own callback, and everything to list among the
    // provider's Redirect URIs (information only).
    redirectUri: `${req.protocol}://${req.get('host')}/auth/callback`,
    redirectUris: redirectUrisFor(req),
    // LOCAL_LOGIN=true: people log in with a password, not through this.
    localLogin: config.localLogin,
    // Which provider everybody logs in through: 'authentik' or one of
    // `providers` (the others, added next to Authentik) by its id.
    ...(await otherProvidersView()),
  };
}

async function otherProvidersView() {
  const { providers, active } = await getOtherProviders();
  return {
    active,
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      issuerUrl: p.issuer,
      clientId: p.clientId,
      hasClientSecret: !!p.clientSecret,
      postLogoutRedirectUri: p.postLogoutRedirectUri,
      requireVerifiedEmail: p.requireVerifiedEmail,
      unreadable: !!p.unreadable,
    })),
  };
}

// Nothing about the providers can be saved without the key the secrets are
// encrypted with.
function assertOidcCanBeSaved() {
  if (!canEncrypt()) {
    throw new AppError(
      'A szerver .env fájljából hiányzik az APP_SECRET_KEY - enélkül a titkok nem menthetők.',
      400,
    );
  }
}

// Refused unless the provider answers at its address - a typo there would
// lock everybody out.
async function assertProviderAnswers(provider) {
  try {
    await discover(provider);
  } catch (err) {
    logger.warn(`OIDC settings refused - ${provider.issuer} doesn't answer: ${err.message}`);
    throw new AppError(
      `A szolgáltató nem válaszol ezen a címen: ${provider.issuer} - semmi nem változott.`,
      400,
    );
  }
}

// Every change to where people log in is e-mailed to all admins.
async function mailOidcChange(req, changes) {
  logger.info(`OIDC settings changed by ${req.user.name}: ${changes.join('; ')}`);
  const admins = await User.find({ role: 'admin', email: { $nin: [null, ''] } }).select('email');
  if (!admins.length) return;
  const lines = changes.map((c) => `<li>${c}</li>`).join('');
  await sendResendEmail({
    to: admins.map((a) => a.email),
    subject: 'Bódorgó: megváltozott az OIDC szolgáltató beállítása',
    html: `<p>${req.user.name} megváltoztatta a bejelentkezés (OIDC szolgáltató) beállításait:</p><ul>${lines}</ul><p>Ha nem tudsz róla, azonnal szólj a szerepkör-kezelő adminnak!</p>`,
    text: [
      `${req.user.name} megváltoztatta a bejelentkezés (OIDC szolgáltató) beállításait:`,
      ...changes,
      '',
      'Ha nem tudsz róla, azonnal szólj a szerepkör-kezelő adminnak!',
    ].join('\n'),
  }).catch((err) => logger.error(`OIDC settings e-mail failed: ${err.message}`));
}

// GET /settings/oidc (role manager).
export const getOidcSettingsView = async (req, res) => {
  res.status(200).json({ status: 'success', data: await oidcView(req) });
};

// PUT /settings/oidc (role manager) - { serverUrl, providerSlug, clientId,
// clientSecret, postLogoutRedirectUri, apiToken, removeApiToken,
// invitationFlow }. An empty clientSecret / apiToken keeps the one in use;
// removeApiToken takes the token away (no invitations). Refused unless the
// provider answers at the new address - a typo there would lock everybody
// out. In the history (never a secret's value), and e-mailed to every admin.
export const updateOidcSettings = async (req, res) => {
  assertOidcCanBeSaved();

  const body = req.body ?? {};
  const current = await getOidcSettings();
  const next = {
    serverUrl: trimUrl(body.serverUrl),
    providerSlug: String(body.providerSlug ?? '').trim(),
    clientId: String(body.clientId ?? '').trim(),
    clientSecret: String(body.clientSecret ?? '').trim() || current.clientSecret,
    postLogoutRedirectUri: String(body.postLogoutRedirectUri ?? '').trim(),
    apiToken:
      body.removeApiToken === true ? '' : String(body.apiToken ?? '').trim() || current.apiToken,
    invitationFlow: String(body.invitationFlow ?? '').trim() || DEFAULT_INVITATION_FLOW,
  };
  if (!isWebAddress(next.serverUrl)) {
    throw new AppError('A Server URL http:// vagy https:// kezdetű cím legyen.', 400);
  }
  if (!SLUG.test(next.providerSlug) || !SLUG.test(next.invitationFlow)) {
    throw new AppError('A slug csak betűt, számot, kötőjelet és aláhúzást tartalmazhat.', 400);
  }
  if (!next.clientId || next.clientId.length > 200) {
    throw new AppError('Add meg a Client ID-t.', 400);
  }
  if (!next.clientSecret) throw new AppError('Add meg a Client secretet.', 400);
  if ([next.clientSecret, next.apiToken].some((secret) => secret.length > 500)) {
    throw new AppError('A titok legfeljebb 500 karakter lehet.', 400);
  }
  if (next.postLogoutRedirectUri && !isWebAddress(next.postLogoutRedirectUri)) {
    throw new AppError('A Logout URI http:// vagy https:// kezdetű cím legyen.', 400);
  }

  await assertProviderAnswers(authentikProvider(next));

  const changes = [
    ['Server URL', current.serverUrl, next.serverUrl],
    ['Provider slug', current.providerSlug, next.providerSlug],
    ['Client ID', current.clientId, next.clientId],
    ['Logout URI', current.postLogoutRedirectUri, next.postLogoutRedirectUri],
    ['Invitation flow', current.invitationFlow, next.invitationFlow],
  ]
    .filter(([, a, b]) => (a ?? '') !== b)
    .map(([label, a, b]) => `${label}: ${a || '(nincs)'} → ${b || '(nincs)'}`);
  if (current.clientSecret !== next.clientSecret) changes.push('Client secret: megváltozott');
  if (current.apiToken !== next.apiToken) {
    changes.push(`API token: ${next.apiToken ? 'megváltozott' : 'törölve'}`);
  }

  // Also the first save of what was only in .env until now.
  if (changes.length || current.source !== 'database') {
    const settings = await getClubSettings();
    settings.set('oidc', storedOidc(next));
    settings.history.push({
      at: new Date(),
      byName: req.user.name,
      change: `OIDC szolgáltató: ${changes.join('; ') || 'mentve (változás nélkül)'}`,
    });
    await settings.save();
  }

  if (changes.length) await mailOidcChange(req, changes);

  res.status(200).json({ status: 'success', data: await oidcView(req) });
};

// --- The other OIDC providers, next to Authentik (the role manager only) ---

const MAX_OTHER_PROVIDERS = 10;

// The settings with the other providers' secrets loaded too - saving the
// list without them would lose them.
const settingsWithProviders = async () => {
  await getClubSettings();
  return ClubSettings.findOne({ key: 'club' }).select('+oidcProviders.clientSecretEnc');
};

// One provider's fields from a request, checked; `saved` is what it is now
// (an empty clientSecret keeps that one's), `others` the rest of the list.
function readProvider(body = {}, saved, others) {
  const next = {
    name: String(body.name ?? '').trim(),
    issuer: String(body.issuerUrl ?? '').trim(),
    clientId: String(body.clientId ?? '').trim(),
    clientSecret: String(body.clientSecret ?? '').trim() || (saved?.clientSecret ?? ''),
    postLogoutRedirectUri: String(body.postLogoutRedirectUri ?? '').trim(),
    requireVerifiedEmail: body.requireVerifiedEmail !== false,
  };
  const sameName = (name) => name.toLowerCase() === next.name.toLowerCase();
  if (!next.name || next.name.length > 50) {
    throw new AppError('Adj nevet a szolgáltatónak (legfeljebb 50 karakter).', 400);
  }
  if (sameName('Authentik') || others.some((p) => sameName(p.name))) {
    throw new AppError('Ilyen nevű szolgáltató már van.', 400);
  }
  if (!isWebAddress(next.issuer)) {
    throw new AppError('Az Issuer URL http:// vagy https:// kezdetű cím legyen.', 400);
  }
  if (!next.clientId || next.clientId.length > 200) {
    throw new AppError('Add meg a Client ID-t.', 400);
  }
  if (!next.clientSecret) throw new AppError('Add meg a Client secretet.', 400);
  if (next.clientSecret.length > 500) {
    throw new AppError('A titok legfeljebb 500 karakter lehet.', 400);
  }
  if (next.postLogoutRedirectUri && !isWebAddress(next.postLogoutRedirectUri)) {
    throw new AppError('A Logout URI http:// vagy https:// kezdetű cím legyen.', 400);
  }
  return next;
}

const storedProvider = (id, p) => ({
  id,
  name: p.name,
  issuerUrl: p.issuer,
  clientId: p.clientId,
  clientSecretEnc: encryptSecret(p.clientSecret),
  postLogoutRedirectUri: p.postLogoutRedirectUri || undefined,
  requireVerifiedEmail: p.requireVerifiedEmail,
});

const onOff = (value) => (value ? 'igen' : 'nem');

// POST /settings/oidc/providers (role manager) - { name, issuerUrl,
// clientId, clientSecret, postLogoutRedirectUri, requireVerifiedEmail }: a
// new provider next to Authentik. Not active yet - that is its own step.
export const addOidcProvider = async (req, res) => {
  assertOidcCanBeSaved();
  const { providers } = await getOtherProviders();
  if (providers.length >= MAX_OTHER_PROVIDERS) {
    throw new AppError(`Legfeljebb ${MAX_OTHER_PROVIDERS} további szolgáltató lehet.`, 400);
  }
  const next = readProvider(req.body, null, providers);
  await assertProviderAnswers(next);

  const settings = await settingsWithProviders();
  const id = crypto.randomUUID();
  settings.oidcProviders.push(storedProvider(id, next));
  const change = `Új szolgáltató: ${next.name} (${next.issuer})`;
  settings.history.push({
    at: new Date(),
    byName: req.user.name,
    change: `OIDC szolgáltató: ${change}`,
  });
  await settings.save();
  await mailOidcChange(req, [change]);
  res.status(201).json({ status: 'success', data: { ...(await oidcView(req)), created: id } });
};

// PUT /settings/oidc/providers/:id (role manager) - the same fields; an
// empty clientSecret keeps the one it has.
export const updateOidcProvider = async (req, res) => {
  assertOidcCanBeSaved();
  const { providers } = await getOtherProviders();
  const saved = providers.find((p) => p.id === req.params.id);
  if (!saved) throw new AppError('Nincs ilyen szolgáltató.', 404);
  const next = readProvider(
    req.body,
    saved,
    providers.filter((p) => p !== saved),
  );
  await assertProviderAnswers(next);

  const changes = [
    ['Név', saved.name, next.name],
    ['Issuer URL', saved.issuer, next.issuer],
    ['Client ID', saved.clientId, next.clientId],
    ['Logout URI', saved.postLogoutRedirectUri, next.postLogoutRedirectUri],
    [
      'Csak megerősített e-mail',
      onOff(saved.requireVerifiedEmail),
      onOff(next.requireVerifiedEmail),
    ],
  ]
    .filter(([, a, b]) => (a ?? '') !== b)
    .map(([label, a, b]) => `${label}: ${a || '(nincs)'} → ${b || '(nincs)'}`);
  if (saved.clientSecret !== next.clientSecret) changes.push('Client secret: megváltozott');

  if (changes.length) {
    const settings = await settingsWithProviders();
    const index = settings.oidcProviders.findIndex((p) => p.id === saved.id);
    settings.oidcProviders.set(index, storedProvider(saved.id, next));
    const change = `${saved.name}: ${changes.join('; ')}`;
    settings.history.push({
      at: new Date(),
      byName: req.user.name,
      change: `OIDC szolgáltató: ${change}`,
    });
    await settings.save();
    await mailOidcChange(req, [change]);
  }
  res.status(200).json({ status: 'success', data: await oidcView(req) });
};

// DELETE /settings/oidc/providers/:id (role manager) - not the active one.
export const deleteOidcProvider = async (req, res) => {
  assertOidcCanBeSaved();
  const { providers, active } = await getOtherProviders();
  const saved = providers.find((p) => p.id === req.params.id);
  if (!saved) throw new AppError('Nincs ilyen szolgáltató.', 404);
  if (active === saved.id) {
    throw new AppError('Az aktív szolgáltató nem törölhető - előbb válassz másikat.', 400);
  }
  const settings = await settingsWithProviders();
  settings.oidcProviders = settings.oidcProviders.filter((p) => p.id !== saved.id);
  const change = `Törölve: ${saved.name}`;
  settings.history.push({
    at: new Date(),
    byName: req.user.name,
    change: `OIDC szolgáltató: ${change}`,
  });
  await settings.save();
  await mailOidcChange(req, [change]);
  res.status(200).json({ status: 'success', data: await oidcView(req) });
};

// PUT /settings/oidc/active (role manager) - { provider: 'authentik' | id }:
// which one everybody logs in through from now on. Refused unless it
// answers at its address.
export const setActiveOidcProvider = async (req, res) => {
  assertOidcCanBeSaved();
  const { providers, active } = await getOtherProviders();
  const id = String(req.body?.provider ?? '');
  const chosen =
    id === AUTHENTIK
      ? authentikProvider(await getOidcSettings())
      : providers.find((p) => p.id === id);
  if (!chosen) throw new AppError('Nincs ilyen szolgáltató.', 404);
  if (!chosen.clientSecret) {
    throw new AppError('Ennek a szolgáltatónak nincs (olvasható) Client secretje.', 400);
  }
  await assertProviderAnswers(chosen);

  if (active !== chosen.id) {
    const before = providers.find((p) => p.id === active)?.name ?? 'Authentik';
    const settings = await settingsWithProviders();
    settings.oidcActiveProvider = chosen.id;
    const change = `Aktív szolgáltató: ${before} → ${chosen.name}`;
    settings.history.push({
      at: new Date(),
      byName: req.user.name,
      change: `OIDC szolgáltató: ${change}`,
    });
    await settings.save();
    await mailOidcChange(req, [change]);
  }
  res.status(200).json({ status: 'success', data: await oidcView(req) });
};

// --- Elnök (the beszámoló PDF's signature and wax seal) ---

// GET /settings/president (admin).
export const getPresident = async (req, res) => {
  const { presidentName } = await getClubSettings();
  res.status(200).json({ status: 'success', data: { presidentName: presidentName ?? '' } });
};

// PUT /settings/president (admin) - { presidentName }.
export const updatePresident = async (req, res) => {
  const presidentName = String(req.body?.presidentName ?? '').trim();
  if (!presidentName || presidentName.length > 100) {
    throw new AppError('Az elnök neve 1-100 karakter lehet.', 400);
  }
  const settings = await getClubSettings();
  const before = settings.presidentName ?? '';
  if (before !== presidentName) {
    settings.presidentName = presidentName;
    settings.history.push({
      at: new Date(),
      byName: req.user.name,
      change: `Elnök: ${before || '-'} → ${presidentName}`,
    });
    await settings.save();
  }
  res.status(200).json({ status: 'success', data: { presidentName } });
};

// GET /settings/president/seal.png (admin) - the wax seal with the saved
// name, as it appears on the beszámoló.
export const getPresidentSeal = async (req, res) => {
  const { presidentName } = await getClubSettings();
  const png = await waxSealPng(presidentName);
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, no-cache');
  res.send(png);
};
