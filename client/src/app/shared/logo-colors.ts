// The 7 colors sampled from the bódorgó logo, defined once as CSS custom
// properties in src/styles.scss (:root). Returns one at random, wrapped as
// a var(...) reference ready for direct use in a [style.color] binding.
const LOGO_COLOR_VARS = [
  '--logo-dark-green',
  '--logo-green',
  '--logo-orange',
  '--logo-brown',
  '--logo-red',
  '--logo-blue',
  '--logo-yellow',
];

export function randomLogoColor(): string {
  const name = LOGO_COLOR_VARS[Math.floor(Math.random() * LOGO_COLOR_VARS.length)];
  return `var(${name})`;
}
