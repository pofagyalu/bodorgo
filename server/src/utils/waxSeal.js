import path from 'path';
import sharp from 'sharp';
import * as fontkit from 'fontkit';

// The red wax seal at the bottom of a tour's beszámoló PDF (see
// tourReportController.js) - an old-time king's-letter stamp, just funnier:
// the club's boot-with-medvehagyma drawing (public/img/logos/
// DSCN2312_ok2.JPG, its middle cut out and turned into white-on-black line
// art once: assets/img/seal-boot.png) pressed into the wax, and the club
// and the elnök's name around the ring. Made as a PNG (pdfkit can't embed
// SVG), per elnök name, and kept in memory.

const rootDir = path.resolve();
const BOOT_PATH = path.join(rootDir, 'assets', 'img', 'seal-boot.png');
const FONT_BOLD = path.join(rootDir, 'assets', 'fonts', 'Mulish-Bold.ttf');

const SIZE = 600;
const C = SIZE / 2;
const WAX_RADIUS = 250;
const RING_OUTER = 238;
const RING_INNER = 188;
const TEXT_RADIUS = 202; // the letters' baseline, tops pointing outwards
const BOOT_BOX = 280;

// The wax's colors: the pressed-in lines' shadow, their lit edge, and the
// lines themselves.
const SHADOW = '#3e0604';
const LIGHT = '#ffb09c';
const PRESSED = '#86130f';

let font;
const cache = new Map();

// A small seeded random, so every seal has the same drips.
function random(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The wax blob: a circle with a wobbly edge and a few drips squeezed out,
// as a smooth closed path (Catmull-Rom through the points).
function blobPath() {
  const rnd = random(1848);
  const drips = Array.from({ length: 7 }, () => ({
    at: rnd() * Math.PI * 2,
    size: 10 + rnd() * 22,
    width: 0.08 + rnd() * 0.12,
  }));
  const phase = [rnd() * 6, rnd() * 6, rnd() * 6];
  const n = 120;
  const points = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let r =
      WAX_RADIUS -
      18 +
      5 * Math.sin(3 * a + phase[0]) +
      3 * Math.sin(7 * a + phase[1]) +
      2 * Math.sin(13 * a + phase[2]);
    for (const d of drips) {
      let diff = Math.abs(a - d.at);
      diff = Math.min(diff, Math.PI * 2 - diff);
      r += d.size * Math.exp(-(diff * diff) / (2 * d.width * d.width));
    }
    points.push([C + r * Math.sin(a), C - r * Math.cos(a)]);
  }
  const p = (i) => points[(i + n) % n];
  let d = `M${p(0)[0].toFixed(1)},${p(0)[1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1.map((v) => v.toFixed(1))} ${c2.map((v) => v.toFixed(1))} ${p2.map((v) => v.toFixed(1))}`;
  }
  return `${d} Z`;
}

// The ring's text, letter by letter along the circle (as outlines - no
// font needed where the SVG is drawn), spread to fill the whole ring.
function ringText(text) {
  font ??= fontkit.openSync(FONT_BOLD);
  const run = font.layout(text);
  const circumference = 2 * Math.PI * TEXT_RADIUS;
  const fontSize = 30;
  const scale = fontSize / font.unitsPerEm;
  const advances = run.positions.map((pos) => pos.xAdvance * scale);
  const natural = advances.reduce((a, b) => a + b, 0);
  const spacing = Math.max(0, (circumference - natural) / run.glyphs.length);

  let along = 0;
  return run.glyphs
    .map((glyph, i) => {
      const width = advances[i];
      const middle = along + width / 2;
      along += width + spacing;
      if (!glyph.path.commands.length) return '';
      const angle = (middle / circumference) * 360;
      const shift = -(glyph.advanceWidth / 2);
      return `<path transform="rotate(${angle.toFixed(2)} ${C} ${C}) translate(${C} ${C - TEXT_RADIUS}) scale(${scale} ${-scale}) translate(${shift} 0)" d="${glyph.path.toSVG()}"/>`;
    })
    .join('');
}

function waxSvg(text) {
  const blob = blobPath();
  // Everything pressed into the wax, drawn three times: a dark shadow down
  // and right, a lit edge up and left, and the line itself.
  const relief = `
    <g id="relief">
      <circle cx="${C}" cy="${C}" r="${RING_OUTER}" fill="none" stroke-width="5"/>
      <circle cx="${C}" cy="${C}" r="${RING_INNER}" fill="none" stroke-width="4"/>
      <g stroke="none">${ringText(text)}</g>
    </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <radialGradient id="wax" cx="0.42" cy="0.38" r="0.7">
      <stop offset="0" stop-color="#dc4a3b"/>
      <stop offset="0.55" stop-color="#a91d16"/>
      <stop offset="1" stop-color="#650c09"/>
    </radialGradient>
    <radialGradient id="pressed" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0.8" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.22"/>
    </radialGradient>
    <filter id="blur6" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7"/></filter>
    <filter id="blur18" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>
    ${relief}
  </defs>
  <path d="${blob}" transform="translate(5 9)" fill="#000" opacity="0.35" filter="url(#blur6)"/>
  <path d="${blob}" fill="url(#wax)"/>
  <path d="${blob}" fill="none" stroke="#4d0806" stroke-opacity="0.45" stroke-width="3"/>
  <circle cx="${C}" cy="${C}" r="${RING_OUTER + 4}" fill="url(#pressed)"/>
  <use xlink:href="#relief" transform="translate(3 3)" fill="${SHADOW}" stroke="${SHADOW}" opacity="0.85"/>
  <use xlink:href="#relief" transform="translate(-2 -2)" fill="${LIGHT}" stroke="${LIGHT}" opacity="0.45"/>
  <use xlink:href="#relief" fill="${PRESSED}" stroke="${PRESSED}"/>
  <ellipse cx="215" cy="175" rx="120" ry="55" transform="rotate(-35 215 175)" fill="#fff" opacity="0.16" filter="url(#blur18)"/>
</svg>`;
}

// One color of the boot drawing: the line art as the alpha of a flat color.
async function bootLayer(mask, width, height, color, opacity) {
  const alpha = Buffer.from(mask.map((v) => Math.round(v * opacity)));
  return sharp({ create: { width, height, channels: 3, background: color } })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
}

// The seal as a PNG (600x600, transparent around the wax).
export async function waxSealPng(presidentName) {
  const name = (presidentName || '').trim().toLocaleUpperCase('hu');
  const text = name ? `BÓDORGÓ KLUB • ELNÖK: ${name} • ` : 'BÓDORGÓ SZABADIDŐS KLUB • 2012 • ';
  if (cache.has(text)) return cache.get(text);

  const { data: mask, info } = await sharp(BOOT_PATH)
    .resize(BOOT_BOX, BOOT_BOX, { fit: 'inside' })
    .extractChannel(0)
    .blur(0.5)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const left = Math.round(C - width / 2);
  const top = Math.round(C - height / 2);
  const [shadow, light, line] = await Promise.all([
    bootLayer(mask, width, height, SHADOW, 0.85),
    bootLayer(mask, width, height, LIGHT, 0.45),
    bootLayer(mask, width, height, PRESSED, 1),
  ]);

  const png = await sharp(Buffer.from(waxSvg(text)))
    .composite([
      { input: shadow, left: left + 3, top: top + 3 },
      { input: light, left: left - 2, top: top - 2 },
      { input: line, left, top },
    ])
    .png()
    .toBuffer();
  cache.set(text, png);
  return png;
}
