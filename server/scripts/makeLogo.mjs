// Makes the club's logo - "BÓDORGÓ" in its own letters (PotLand), each in
// its colour - from the font itself, so it is sharp at any size:
//   client/src/assets/images/transparent_color_logo.svg  (the site's header)
//   client/public/img/transparent_color_logo.svg         (the same)
//   server/assets/img/logo.png                           (the PDFs: 1200 wide)
//   client/design/bodorgo-logo.svg, bodorgo-logo.png     (to keep: 4000 wide)
// The letters are written out as outlines: the font isn't needed to show it.
// Run from server/ (fontkit and sharp live here): node scripts/makeLogo.mjs
import fs from 'fs';
import path from 'path';
import * as fontkit from 'fontkit';
import sharp from 'sharp';

const client = path.resolve('..', 'client');
const font = fontkit.openSync(path.resolve('assets', 'fonts', 'PotLand.ttf'));

// B-Ó-D-O-R-G-Ó, as the logo colours them (the client's styles.scss).
const LETTERS = [
  ['B', '#f07827'],
  ['Ó', '#835638'],
  ['D', '#72b45d'],
  ['O', '#096396'],
  ['R', '#1b6548'],
  ['G', '#f40e0d'],
  ['Ó', '#f6b528'],
];
// Between two letters, in the font's own units (the songbook's cover has
// the same: 2 of 78).
const GAP = (2 / 78) * font.unitsPerEm;
// Empty room around the letters, in the same units.
const MARGIN = 0.02 * font.unitsPerEm;

const round = (n) => Math.round(n * 10) / 10;

// The letters side by side: each one's outline moved to its place. The
// font's y grows upwards, the picture's downwards - turned over below.
let x = 0;
const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
const placed = LETTERS.map(([letter, color]) => {
  const glyph = font.layout(letter).glyphs[0];
  const at = x;
  box.minX = Math.min(box.minX, at + glyph.bbox.minX);
  box.maxX = Math.max(box.maxX, at + glyph.bbox.maxX);
  box.minY = Math.min(box.minY, glyph.bbox.minY);
  box.maxY = Math.max(box.maxY, glyph.bbox.maxY);
  x += glyph.advanceWidth + GAP;
  return { glyph, color, at };
});

const width = box.maxX - box.minX + 2 * MARGIN;
const height = box.maxY - box.minY + 2 * MARGIN;
// A letter's outline in the picture's own coordinates.
const outline = ({ glyph, at }) =>
  glyph.path
    .translate(at - box.minX + MARGIN, 0)
    .scale(1, -1)
    .translate(0, box.maxY + MARGIN)
    .toSVG()
    .replace(/-?\d+\.\d+/g, (n) => String(round(Number(n))));

// An outline's closed shapes one by one, each with the area it goes round
// (signed: which way it goes round). The area is taken over the points the
// shape passes through - near enough to tell a letter's body from a hole.
function shapes(d) {
  return d
    .split(/(?=M)/)
    .filter(Boolean)
    .map((shape) => {
      const points = [...shape.matchAll(/[MLQC]([^MLQCZ]*)/g)].map(([, numbers]) =>
        numbers
          .trim()
          .split(/[\s,]+/)
          .map(Number)
          .slice(-2),
      );
      const area = points.reduce((sum, [px, py], i) => {
        const [nx, ny] = points[(i + 1) % points.length];
        return sum + px * ny - nx * py;
      }, 0);
      const xs = points.map((p) => p[0]);
      const ys = points.map((p) => p[1]);
      const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      return { shape, area, box };
    });
}
if (process.env.LOGO_SHAPES) {
  placed.forEach((p, i) =>
    console.log(
      LETTERS[i][0],
      shapes(outline(p))
        .map((s) => `${Math.round(s.area / 1000)}[${s.box.map(Math.round).join(',')}]`)
        .join('  '),
    ),
  );
}

// The leaves are holes in the letters: white under them, so they are white
// on any ground (not what happens to be behind the logo). A hole goes round
// the other way than the letter's body, its largest shape.
// With `least`: only the holes at least that large - the leaves themselves,
// without the specks beside them.
function leaves(d, least = 0) {
  const all = shapes(d);
  const body = all.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a));
  return all
    .filter((s) => Math.sign(s.area) !== Math.sign(body.area) && Math.abs(s.area) >= least)
    .map((s) => s.shape)
    .join('');
}
// A leaf's area is 80 000 and more (in the font's units, doubled); a speck's
// 15 000 at most.
const LEAF = 50000;
// The black line round each leaf: thin - a pixel in the 1200 wide picture.
const LEAF_LINE = 0.005 * font.unitsPerEm;

const drawn = placed.map((p) => ({ color: p.color, d: outline(p) }));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(width)} ${round(height)}" role="img" aria-label="Bódorgó">
  <path fill="#fff" d="${drawn.map((p) => leaves(p.d)).join('')}"/>
${drawn.map((p) => `  <path fill="${p.color}" d="${p.d}"/>`).join('\n')}
  <path fill="#fff" stroke="#000" stroke-width="${round(LEAF_LINE)}" stroke-linejoin="round" d="${drawn.map((p) => leaves(p.d, LEAF)).join('')}"/>
</svg>
`;

const write = (file, data) => {
  fs.writeFileSync(file, data);
  console.log(`${path.relative(path.resolve('..'), file)}  ${data.length} bytes`);
};
const png = (wide) =>
  sharp(Buffer.from(svg), { density: 72 * (wide / width) * 1.01 })
    .resize(wide)
    .png()
    .toBuffer();

write(path.join(client, 'src', 'assets', 'images', 'transparent_color_logo.svg'), svg);
write(path.join(client, 'public', 'img', 'transparent_color_logo.svg'), svg);
write(path.resolve('assets', 'img', 'logo.png'), await png(1200));
write(path.join(client, 'design', 'bodorgo-logo.svg'), svg);
write(path.join(client, 'design', 'bodorgo-logo.png'), await png(4000));
