import { CIRCLE, DEGREES, keyChords } from './songText.js';

// The Daloskönyv PDF's last two pages (songBook.js): the circle of fifths
// (Kvintkör) and the table of every key's chords (Akkordtáblázat) - both
// drawn, in the songbook's own notation (H is B, B is B♭, minors in lower
// case). The app shows the same two beside the songs (the client's
// pages/daloskonyv/circle-of-fifths and chord-table).

const INK = '#1f2d3a';
const GREY = '#56666e';
const LIGHT = '#e4eae7';
const GREEN = '#1b6548';
const RUST = '#b5533a';

// The wedges' colours: the sharp keys warm, the flat keys cool, C between.
const TINTS = [
  '#f6b528',
  '#f39a27',
  '#f07827',
  '#e0583a',
  '#c9433f',
  '#a8456b',
  '#7a4f8f',
  '#4f5aa3',
  '#096396',
  '#1b7f86',
  '#1b6548',
  '#72b45d',
];

// "1. sz. melléklet": how the book numbers its annexes.
const annexLabel = (number) => `${number}. sz. melléklet`;

// A page's heading: its title, and what it is under it - and which annex
// it is, in the corner across.
function heading(doc, number, title, about, margin) {
  const label = annexLabel(number).toUpperCase();
  doc.font('Heading').fontSize(8.5).fillColor(RUST);
  const labelWidth = doc.widthOfString(label, { characterSpacing: 0.8 });
  doc.text(label, doc.page.width - margin - labelWidth, margin + 7, {
    lineBreak: false,
    characterSpacing: 0.8,
  });
  doc.font('Heading').fontSize(18).fillColor(GREEN).text(title, margin, margin, {
    lineBreak: false,
  });
  doc
    .font('Italic')
    .fontSize(10.5)
    .fillColor(GREY)
    .text(about, margin, margin + 24, { lineBreak: false });
}

// How to read the page: a few lines, each after a dot. Answers where they end.
function notes(doc, lines, margin, top) {
  let y = top;
  const options = { width: doc.page.width - margin * 2 - 12, lineGap: 1.5 };
  for (const line of lines) {
    doc.circle(margin + 3, y + 5.5, 1.6).fill(RUST);
    doc
      .font('Body')
      .fontSize(10)
      .fillColor(INK)
      .text(line, margin + 12, y, options);
    y += doc.heightOfString(line, options) + 6;
  }
  return y;
}

// --- Kvintkör ---

const CIRCLE_ABOUT = 'Az ötösök köre – a hangnemek és rokonaik';

const point = (cx, cy, r, degrees) => {
  const a = (degrees * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};

// A slice of a ring: between two radii and two angles.
function wedge(doc, cx, cy, inner, outer, from, to) {
  const [x1, y1] = point(cx, cy, outer, from);
  const [x2, y2] = point(cx, cy, outer, to);
  const [x3, y3] = point(cx, cy, inner, to);
  const [x4, y4] = point(cx, cy, inner, from);
  return doc.path(
    `M ${x1} ${y1} A ${outer} ${outer} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 0 0 ${x4} ${y4} Z`,
  );
}

// Text centred on a point - one line, or two ("F#" over "Gb").
function label(doc, lines, x, y, { font, size, color }) {
  const lineHeight = size * 1.08;
  doc.font(font).fontSize(size).fillColor(color);
  lines.forEach((line, i) => {
    const width = doc.widthOfString(line);
    const top = y - (lines.length * lineHeight) / 2 + i * lineHeight;
    doc.text(line, x - width / 2, top, { lineBreak: false });
  });
}

// margin: the page's side and top margin; bottom: where its text ends.
function drawCircleOfFifths(doc, { margin, bottom }) {
  const { width } = doc.page;
  heading(doc, 1, 'Kvintkör', CIRCLE_ABOUT, margin);

  const notesHeight = 118;
  const top = margin + 52;
  const radius = Math.min((width - margin * 2) / 2, (bottom - notesHeight - top) / 2);
  const cx = width / 2;
  const cy = top + radius;
  // The rings, from the outside in: major keys, their minors, the signs.
  const rings = [radius, radius * 0.72, radius * 0.5, radius * 0.33];
  const scale = radius / 250;

  CIRCLE.forEach((key, i) => {
    // C at the top: its wedge is the 30° around straight up.
    const from = -105 + i * 30;
    const to = from + 30;
    const middle = from + 15;
    wedge(doc, cx, cy, rings[1], rings[0], from, to).fillOpacity(0.3).fill(TINTS[i]);
    wedge(doc, cx, cy, rings[2], rings[1], from, to).fillOpacity(0.16).fill(TINTS[i]);
    wedge(doc, cx, cy, rings[3], rings[2], from, to).fillOpacity(0.07).fill(TINTS[i]);
    doc.fillOpacity(1);
    for (let ring = 0; ring < 3; ring += 1) {
      wedge(doc, cx, cy, rings[ring + 1], rings[ring], from, to)
        .lineWidth(0.8)
        .strokeColor('#ffffff')
        .stroke();
    }
    const two = key.major.length > 1;
    label(doc, key.major, ...point(cx, cy, (rings[0] + rings[1]) / 2, middle), {
      font: 'Heading',
      size: (two ? 17 : 24) * scale,
      color: INK,
    });
    label(doc, key.minor, ...point(cx, cy, (rings[1] + rings[2]) / 2, middle), {
      font: 'Heading',
      size: (two ? 11 : 15) * scale,
      color: RUST,
    });
    label(doc, key.signs, ...point(cx, cy, (rings[2] + rings[3]) / 2, middle), {
      font: 'Body',
      size: (two ? 8 : 9.5) * scale,
      color: GREY,
    });
  });
  doc.circle(cx, cy, rings[0]).lineWidth(1).strokeColor('#c9d6d1').stroke();
  label(doc, ['dúr', 'moll'], cx, cy, { font: 'Italic', size: 11 * scale, color: GREY });

  notes(
    doc,
    [
      'A külső körben a dúr hangnemek, alattuk a párhuzamos mollok (C-dúr – a-moll), legbelül az előjegyzés: hány kereszt (#) vagy bé (b).',
      'Az óramutató járása szerint egy lépés egy kvinttel feljebb visz, és eggyel több keresztet (vagy eggyel kevesebb bét) jelent.',
      'Egy dal három fő akkordja a körön egymás mellett áll: C mellett az F és a G. A hozzájuk tartozó mollok (dm, am, em) is jól szólnak velük.',
      'A daloskönyv jelölése: H a nemzetközi B, a B pedig a Bb (bé) – a mollok kisbetűvel.',
    ],
    margin,
    cy + radius + 22,
  );
}

// --- Akkordtáblázat ---

const TABLE_ABOUT = 'Melyik hangnemben milyen akkordok – hallás utáni kereséshez';

// For every major key the seven chords built on its notes; the three main
// ones (I, IV, V) in tinted columns.
function drawChordTable(doc, { margin }) {
  const { width } = doc.page;
  heading(doc, 2, 'Akkordtáblázat', TABLE_ABOUT, margin);

  const left = margin;
  const right = width - margin;
  const keyWidth = (right - left) * 0.2;
  const column = (right - left - keyWidth) / DEGREES.length;
  // Tighter rows on the smaller paper.
  const row = width < 500 ? 20 : 27;
  const size = width < 500 ? 10 : 12.5;
  const top = margin + 56;
  const keys = keyChords();
  const x = (i) => left + keyWidth + i * column;
  const centre = (text, cx, y, options) => {
    doc.font(options.font).fontSize(options.size).fillColor(options.color);
    doc.text(text, cx - doc.widthOfString(text) / 2, y, { lineBreak: false });
  };

  // The main chords' columns, tinted all the way down.
  DEGREES.forEach((degree, i) => {
    if (degree.kind !== 'major') return;
    doc.rect(x(i), top, column, row * (keys.length + 1)).fill('#fdf3ee');
  });
  doc
    .rect(left, top, right - left, row)
    .fillOpacity(0.5)
    .fill('#eef3f1');
  doc.fillOpacity(1);

  const textTop = (rowTop) => rowTop + (row - size) / 2 - 1;
  doc
    .font('Heading')
    .fontSize(9)
    .fillColor(GREY)
    .text('Hangnem', left + 8, top + (row - 9) / 2 - 1, { lineBreak: false });
  DEGREES.forEach((degree, i) => {
    centre(degree.roman, x(i) + column / 2, textTop(top), {
      font: 'Heading',
      size,
      color: degree.kind === 'major' ? RUST : GREY,
    });
  });

  keys.forEach((key, r) => {
    const rowTop = top + row * (r + 1);
    doc
      .font('Heading')
      .fontSize(size)
      .fillColor(INK)
      .text(key.key, left + 8, textTop(rowTop), { lineBreak: false });
    key.chords.forEach((chord, i) => {
      const { kind } = DEGREES[i];
      centre(chord, x(i) + column / 2, textTop(rowTop), {
        font: kind === 'major' ? 'Heading' : 'Body',
        size,
        color: kind === 'major' ? INK : kind === 'minor' ? RUST : '#9aa7ab',
      });
    });
  });

  // The lines: under every row, and around the whole.
  doc.lineWidth(0.6).strokeColor(LIGHT);
  for (let r = 1; r <= keys.length; r += 1) {
    doc
      .moveTo(left, top + row * r)
      .lineTo(right, top + row * r)
      .stroke();
  }
  doc
    .moveTo(left + keyWidth, top)
    .lineTo(left + keyWidth, top + row * (keys.length + 1))
    .stroke();
  doc.roundedRect(left, top, right - left, row * (keys.length + 1), 6).stroke();

  notes(
    doc,
    [
      'Egy sor egy dúr hangnem hét akkordja. A legtöbb dal a három fő akkordból áll: az I, a IV és az V (C-dúrban: C, F, G).',
      'Ha egy dalban moll is szól, az leggyakrabban a vi (C-dúrban: am), utána a ii és a iii.',
      'Hallás után: keresd meg, melyik akkordon „ér haza” a dal – az az I. A sorában megvan a többi is.',
      'Moll hangnemű dalhoz a párhuzamos dúr sorát nézd: az a-moll dal akkordjai a C-dúr sorában vannak (a vi a „hazai” akkord).',
      'Gyakori menetek: I – IV – V – I, I – vi – IV – V, I – V – vi – IV.',
    ],
    margin,
    top + row * (keys.length + 1) + 22,
  );
}

// The pages after the songs, in their order: what the contents call each,
// and how it is drawn ({ margin, bottom }: the page's margin, and where
// its text ends).
export const ANNEXES = [
  { title: `${annexLabel(1)} – Kvintkör`, draw: drawCircleOfFifths },
  { title: `${annexLabel(2)} – Akkordtáblázat`, draw: drawChordTable },
];
