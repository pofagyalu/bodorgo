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
