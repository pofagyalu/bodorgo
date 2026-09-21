// The 7 colors sampled from the bódorgó logo, defined once as CSS custom
// properties in src/styles.scss (:root), used as var(...) references
// ready for direct use in a [style.color] binding.
const LOGO_COLOR_VARS = [
  '--logo-dark-green',
  '--logo-green',
  '--logo-orange',
  '--logo-brown',
  '--logo-red',
  '--logo-blue',
  '--logo-yellow',
];

// A shuffled copy of every logo color - since it's a permutation of the
// full set rather than independent random picks, taking colors off the
// front (one per icon) can never repeat one already handed out, unlike
// drawing at random with replacement per icon (which can coincidentally
// repeat a color, e.g. the same yellow twice on one page).
export function shuffledLogoColors(): string[] {
  const colors = LOGO_COLOR_VARS.map((name) => `var(${name})`);
  for (let i = colors.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [colors[i], colors[j]] = [colors[j], colors[i]];
  }
  return colors;
}
