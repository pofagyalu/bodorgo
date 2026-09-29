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

// "kb. 2ó 45p" / "kb. 45p" / "kb. 2ó" - short, it's in brackets
// after the distance on the tour page. "kb." (approx.) since this is a
// routing estimate (see distance.js server-side), not a promise -
// traffic/weather/actual driving style all vary. The PDF
// (server/src/utils/distance.js's formatDrivingDuration) writes it out
// in full ("óra"/"perc").
export function formatDrivingDuration(minutes: number | null | undefined): string {
  if (minutes == null) return '';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `kb. ${mins}p`;
  if (mins === 0) return `kb. ${hours}ó`;
  return `kb. ${hours}ó ${mins}p`;
}
