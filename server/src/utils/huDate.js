// Hungarian dates, without relying on the server's locale data. The live
// server's Node.js only has English locale data ("small ICU"): asked for
// 'hu-HU' (or the 'sv-SE' YYYY-MM-DD trick) it quietly answers in English.
// So only plain numbers are taken from Intl - in Budapest time, with the
// English locale every build has - and the Hungarian names come from here.

const MONTHS = [
  'január',
  'február',
  'március',
  'április',
  'május',
  'június',
  'július',
  'augusztus',
  'szeptember',
  'október',
  'november',
  'december',
];
const WEEKDAYS = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Budapest',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

// The date's calendar parts in Budapest: { year, month (1-12), day, hour,
// minute, weekday (0 = vasárnap) }.
export function budapestParts(date = new Date()) {
  const parts = {};
  for (const { type, value } of partsFormat.formatToParts(new Date(date))) {
    if (type !== 'literal') parts[type] = Number(value);
  }
  const { year, month, day } = parts;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, hour: parts.hour % 24, minute: parts.minute, weekday };
}

const pad = (n) => String(n).padStart(2, '0');

// "2026-09-29" - today (or that moment) in Budapest.
export function budapestYmd(date = new Date()) {
  const { year, month, day } = budapestParts(date);
  return `${year}-${pad(month)}-${pad(day)}`;
}

// "2026. szeptember 29."
export function huDate(date) {
  const { year, month, day } = budapestParts(date);
  return `${year}. ${MONTHS[month - 1]} ${day}.`;
}

// "2026. szeptember 29., kedd"
export function huDateWeekday(date) {
  return `${huDate(date)}, ${WEEKDAYS[budapestParts(date).weekday]}`;
}

// "14:05"
export function huTime(date) {
  const { hour, minute } = budapestParts(date);
  return `${pad(hour)}:${pad(minute)}`;
}

// "2026. szeptember 29. 14:05"
export function huDateTime(date) {
  return `${huDate(date)} ${huTime(date)}`;
}

// A tour's days, from its first to its last: "2023. október 20–23.", or
// across a month "2023. október 30. – november 2.", or a year "2023.
// december 30. – 2024. január 2.".
export function huDateRange(start, days) {
  const first = budapestParts(start);
  const lastUtc = new Date(
    Date.UTC(first.year, first.month - 1, first.day + Math.max(1, days) - 1),
  );
  const last = {
    year: lastUtc.getUTCFullYear(),
    month: lastUtc.getUTCMonth() + 1,
    day: lastUtc.getUTCDate(),
  };
  const head = `${first.year}. ${MONTHS[first.month - 1]} ${first.day}`;
  if (last.year !== first.year) {
    return `${head}. – ${last.year}. ${MONTHS[last.month - 1]} ${last.day}.`;
  }
  if (last.month !== first.month) return `${head}. – ${MONTHS[last.month - 1]} ${last.day}.`;
  return last.day === first.day ? `${head}.` : `${head}–${last.day}.`;
}

// One day of a tour, in the beszámoló editor: "október 20., péntek".
export function huDayLabel(start, dayIndex) {
  const first = budapestParts(start);
  const at = new Date(Date.UTC(first.year, first.month - 1, first.day + dayIndex));
  return `${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}., ${WEEKDAYS[at.getUTCDay()]}`;
}
