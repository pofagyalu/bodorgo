// Thousands grouping (space separator, e.g. "39 000") for money amounts.
// Not Intl.NumberFormat('hu-HU') - that locale's CLDR data only groups
// once there'd be at least two leading digits before the first separator,
// so e.g. 4588 renders as plain "4588" (no space) while 10000+ does get
// one. That's real Hungarian typographic convention, but not what's
// wanted here - grouping every three digits unconditionally instead.
export function formatForint(amount: number | null): string {
  if (amount == null) return '';
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? '-' : '';
  const digits = Math.abs(rounded).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// "kb. 2 óra 45 perc" / "kb. 45 perc" / "kb. 2 óra" - "kb." (approx.)
// since this is a routing estimate (see distance.js server-side), not a
// promise - traffic/weather/actual driving style all vary. Mirrors
// server/src/utils/distance.js's formatDrivingDuration (used in the PDF)
// so the wording matches wherever it's shown.
export function formatDrivingDuration(minutes: number | null | undefined): string {
  if (minutes == null) return '';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `kb. ${mins} perc`;
  if (mins === 0) return `kb. ${hours} óra`;
  return `kb. ${hours} óra ${mins} perc`;
}
