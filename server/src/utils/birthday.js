// Születésnap: a user logging in on their birthday gets confetti and a
// greeting (the client's birthday-celebration component) - once per year,
// set up on Klub → Beállítások (clubSettingsModel.js's birthday).

// The effects the client knows (shared/birthday-celebration).
export const BIRTHDAY_EFFECTS = ['confetti', 'fireworks', 'cannons', 'stars', 'snow', 'emoji'];

export const DEFAULT_BIRTHDAY_MESSAGE = 'Boldog születésnapot, {név}! 🎂';

// Today in Budapest, "YYYY-MM-DD". (Its own copy of membershipReminders.js's
// budapestDate - this module is imported by clubSettingsModel.js, and must
// import nothing that leads back to it.)
export const budapestToday = (now = new Date()) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Budapest' }).format(now);

// Is `day` ("YYYY-MM-DD", Budapest) the birthday? Birthdays are stored as
// midnight UTC, so their UTC month/day is the real one. 29 February is
// celebrated on 28 February in other years.
export function isBirthday(birthday, day = budapestToday()) {
  if (!birthday) return false;
  const b = new Date(birthday);
  const [year, month, date] = day.split('-').map(Number);
  let bMonth = b.getUTCMonth() + 1;
  let bDate = b.getUTCDate();
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  if (bMonth === 2 && bDate === 29 && !leap) bDate = 28;
  return bMonth === month && bDate === date;
}

// "Nagy Zoltán" -> "Zoltán": Hungarian names put the given name last.
export function givenName(user) {
  if (user.firstName?.trim()) return user.firstName.trim();
  const parts = String(user.name ?? '')
    .trim()
    .split(/\s+/);
  return parts.at(-1) || '';
}

export const fillMessage = (template, user) =>
  (template || DEFAULT_BIRTHDAY_MESSAGE).replaceAll('{név}', givenName(user));
