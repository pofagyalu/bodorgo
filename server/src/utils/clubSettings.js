import ClubSettings from '../models/clubSettingsModel.js';

// The club has collected membership dues since its founding year - no
// fee is ever owed for a year before this.
export const CLUB_FOUNDING_YEAR = 2019;

// What the club charged before the fee became an admin setting.
const DEFAULT_MEMBERSHIP_FEES = [{ fromYear: CLUB_FOUNDING_YEAR, amount: 1000 }];

// The settings document, created with the defaults the first time it's
// needed.
export async function getClubSettings() {
  return (
    (await ClubSettings.findOne({ key: 'club' })) ??
    (await ClubSettings.findOneAndUpdate(
      { key: 'club' },
      { $setOnInsert: { key: 'club', membershipFees: DEFAULT_MEMBERSHIP_FEES, history: [] } },
      { upsert: true, returnDocument: 'after' },
    ))
  );
}

// The fee for one year: the latest row that has started by then. Rows can
// be in any order.
export function feeForYear(fees, year) {
  const row = [...fees]
    .filter((f) => f.fromYear <= year)
    .sort((a, b) => b.fromYear - a.fromYear)[0];
  return row ? row.amount : null;
}

export async function membershipFeeForYear(year) {
  return feeForYear((await getClubSettings()).membershipFees, year);
}

// Fizetési módok (Beállítások): the online gateways a payer can choose
// from - each one on or off, with the fee the payer pays on top.
export const PAYMENT_METHOD_NAMES = { stripe: 'Stripe', barion: 'Barion' };

// What the pages and the fee calculation use of one method.
export function paymentMethodView(method = {}) {
  return {
    enabled: !!method.enabled,
    feePercent: method.feePercent ?? 0,
    feeFixed: method.feeFixed ?? 0,
    feeMin: method.feeMin ?? 0,
  };
}

export async function paymentMethod(key) {
  return paymentMethodView((await getClubSettings()).paymentMethods?.[key]);
}

// The fee on top of a sum: the gateway takes its percent of the whole
// charge plus a fixed part, so the charge is worked out backwards - what's
// left after the gateway's cut is the sum itself. At least feeMin. The
// client shows the same figure (services/settings.ts's paymentFee).
export function paymentFee(subtotal, { feePercent, feeFixed, feeMin }) {
  if (!(subtotal > 0)) return 0;
  const charge = Math.round((subtotal + feeFixed) / (1 - feePercent / 100));
  return Math.max(charge - subtotal, feeMin);
}

// One Barion wallet's settings - 'membership' (Tagdíjak) or 'tour'
// (Előlegek); empty until an admin sets them on Beállítások.
export async function barionWallet(key) {
  const wallet = (await getClubSettings()).barion?.[key];
  return wallet?.toObject?.() ?? wallet ?? {};
}
