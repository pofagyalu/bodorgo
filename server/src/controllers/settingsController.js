import Transaction from '../models/transactionModel.js';
import AppError from '../utils/appError.js';
import { CLUB_FOUNDING_YEAR, feeForYear, getClubSettings } from '../utils/clubSettings.js';

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
