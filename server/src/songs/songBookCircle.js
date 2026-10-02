// The Daloskönyv PDF's last page (songBook.js): the circle of fifths -
// drawn, in the songbook's own notation (H is B, B is B♭, minors in
// lower case).

export const CIRCLE_TITLE = 'Kvintkör';

const INK = '#1f2d3a';
const GREY = '#56666e';
const GREEN = '#1b6548';
const RUST = '#b5533a';

// Clockwise from the top, a fifth up at each step.
const MAJORS = ['C', 'G', 'D', 'A', 'E', 'H', 'F#\nGb', 'Db', 'Ab', 'Eb', 'B', 'F'];
const MINORS = ['am', 'em', 'hm', 'f#m', 'c#m', 'g#m', 'd#m\nebm', 'bm', 'fm', 'cm', 'gm', 'dm'];
// How many sharps or flats the key is written with.
const SIGNS = [
  '0',
  '1 #',
  '2 #',
  '3 #',
  '4 #',
  '5 #',
  '6 #\n6 b',
  '5 b',
  '4 b',
  '3 b',
  '2 b',
  '1 b',
];

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
function label(doc, text, x, y, { font, size, color }) {
  const lines = text.split('\n');
  const lineHeight = size * 1.08;
  doc.font(font).fontSize(size).fillColor(color);
  lines.forEach((line, i) => {
    const width = doc.widthOfString(line);
    const top = y - (lines.length * lineHeight) / 2 + i * lineHeight;
    doc.text(line, x - width / 2, top, { lineBreak: false });
  });
}

// margin: the page's side and top margin; bottom: where its text ends.
export function drawCircleOfFifths(doc, { margin, bottom }) {
  const { width } = doc.page;
  doc.font('Heading').fontSize(18).fillColor(GREEN).text(CIRCLE_TITLE, margin, margin, {
    lineBreak: false,
  });
  doc
    .font('Italic')
    .fontSize(10.5)
    .fillColor(GREY)
    .text('Az ötösök köre – a hangnemek és rokonaik', margin, margin + 24, { lineBreak: false });

  const notesHeight = 118;
  const top = margin + 52;
  const radius = Math.min((width - margin * 2) / 2, (bottom - notesHeight - top) / 2);
  const cx = width / 2;
  const cy = top + radius;
  // The rings, from the outside in: major keys, their minors, the signs.
  const rings = [radius, radius * 0.72, radius * 0.5, radius * 0.33];

  MAJORS.forEach((major, i) => {
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
    const scale = radius / 250;
    label(doc, major, ...point(cx, cy, (rings[0] + rings[1]) / 2, middle), {
      font: 'Heading',
      size: (major.includes('\n') ? 17 : 24) * scale,
      color: INK,
    });
    label(doc, MINORS[i], ...point(cx, cy, (rings[1] + rings[2]) / 2, middle), {
      font: 'Heading',
      size: (MINORS[i].includes('\n') ? 11 : 15) * scale,
      color: RUST,
    });
    label(doc, SIGNS[i], ...point(cx, cy, (rings[2] + rings[3]) / 2, middle), {
      font: 'Body',
      size: (SIGNS[i].includes('\n') ? 8 : 9.5) * scale,
      color: GREY,
    });
  });
  doc.circle(cx, cy, rings[0]).lineWidth(1).strokeColor('#c9d6d1').stroke();
  label(doc, 'dúr\nmoll', cx, cy, { font: 'Italic', size: 11 * (radius / 250), color: GREY });

  // How to read it.
  const notes = [
    'A külső körben a dúr hangnemek, alattuk a párhuzamos mollok (C-dúr – a-moll), legbelül az előjegyzés: hány kereszt (#) vagy bé (b).',
    'Az óramutató járása szerint egy lépés egy kvinttel feljebb visz, és eggyel több keresztet (vagy eggyel kevesebb bét) jelent.',
    'Egy dal három fő akkordja a körön egymás mellett áll: C mellett az F és a G. A hozzájuk tartozó mollok (dm, am, em) is jól szólnak velük.',
    'A daloskönyv jelölése: H a nemzetközi B, a B pedig a B♭ (bé) – a mollok kisbetűvel.',
  ];
  let y = cy + radius + 22;
  doc.font('Body').fontSize(10).fillColor(INK);
  for (const note of notes) {
    const options = { width: width - margin * 2 - 12, lineGap: 1.5 };
    doc.circle(margin + 3, y + 5.5, 1.6).fill(RUST);
    doc.fillColor(INK).text(note.replace('♭', 'b'), margin + 12, y, options);
    y += doc.heightOfString(note, options) + 6;
  }
}
