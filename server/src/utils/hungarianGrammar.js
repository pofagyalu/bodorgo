const BACK_VOWELS = new Set(['a', 'á', 'o', 'ó', 'u', 'ú']);
const FRONT_VOWELS = new Set(['e', 'é', 'i', 'í', 'ö', 'ő', 'ü', 'ű']);

// Hungarian's ablative case ("from X") - -tól after back vowels, -től
// after front vowels (vowel harmony), plus a near-universal extra rule: a
// bare final "a"/"e" lengthens to "á"/"é" before the suffix ("Pápa" ->
// "Pápától", not "Pápatól"). This is a heuristic, not a dictionary - it
// gets the vast majority of real Hungarian (and Hungarianized foreign,
// e.g. "Oradeától") place names right by applying the same rule a
// Hungarian speaker would apply on the fly, but Hungarian vowel harmony
// does have genuinely irregular exceptions no simple rule can catch.
// Used for both the fixed "Budapesttől" case and a user's own home town
// (see userModel.js's city field) - one code path, not two.
export function hungarianFromSuffix(placeName) {
  const trimmed = placeName.trim();
  if (!trimmed) return '';

  const lastChar = trimmed.slice(-1);
  const lastCharLower = lastChar.toLowerCase();

  if (lastCharLower === 'a') {
    return `${trimmed.slice(0, -1)}${lastChar === lastChar.toUpperCase() ? 'Á' : 'á'}tól`;
  }
  if (lastCharLower === 'e') {
    return `${trimmed.slice(0, -1)}${lastChar === lastChar.toUpperCase() ? 'É' : 'é'}től`;
  }

  // Otherwise: harmony decided by the LAST vowel anywhere in the word,
  // scanning from the end (the standard heuristic).
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const ch = trimmed[i].toLowerCase();
    if (BACK_VOWELS.has(ch)) return `${trimmed}tól`;
    if (FRONT_VOWELS.has(ch)) return `${trimmed}től`;
  }

  // No vowel at all - shouldn't happen for a real place name, but front
  // is the more common default among genuinely ambiguous/neutral cases.
  return `${trimmed}től`;
}
