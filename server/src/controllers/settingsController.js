import Transaction from '../models/transactionModel.js';
import AppError from '../utils/appError.js';
import {
  CLUB_FOUNDING_YEAR,
  feeForYear,
  getClubSettings,
  membershipFeeForYear,
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
// page's pay dialog uses them); admins also get the change history and
// which years are already paid for (locked).
export const getMembershipFees = async (req, res) => {
  const settings = await getClubSettings();
  const isAdmin = req.user.role === 'admin';
  res.status(200).json({
    status: 'success',
    data: {
      fees: [...settings.membershipFees].sort((a, b) => a.fromYear - b.fromYear),
      foundingYear: CLUB_FOUNDING_YEAR,
      ...(isAdmin
        ? { paidYears: await paidYears(), history: [...settings.history].reverse() }
        : {}),
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
