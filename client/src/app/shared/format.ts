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
