import { huDate } from '../utils/huDate.js';

// The Daloskönyv PDF's cover (songBook.js): cream paper in a thin frame,
// "Bódorgó" in the club's own letters (the 'Logo' font, registered by
// songBook.js), the title - and under it an evening in the hills, with a
// campfire and the song rising from it. All drawn: no picture in it.

const MM = 72 / 25.4;
const CREAM = '#f6ecd6';
const RUST = '#b5533a';
// The club's colours (the logo's - see the client's styles.scss).
const LOGO = {
  darkGreen: '#1b6548',
  green: '#72b45d',
  orange: '#f07827',
  brown: '#835638',
  red: '#f40e0d',
  blue: '#096396',
  yellow: '#f6b528',
};

// B-Ó-D-O-R-G-Ó, as the logo colours them.
const LOGO_LETTERS = [
  LOGO.orange,
  LOGO.brown,
  LOGO.green,
  LOGO.blue,
  LOGO.darkGreen,
  LOGO.red,
  LOGO.yellow,
];

const DIAGRAM_LABEL = { guitar: 'gitár akkordokkal', ukulele: 'ukulele akkordokkal' };

// A line of text centred on the page.
function centred(doc, text, y, { font, size, color, characterSpacing = 0 }) {
  doc.font(font).fontSize(size).fillColor(color).text(text, 0, y, {
    width: doc.page.width,
    align: 'center',
    lineBreak: false,
    characterSpacing,
  });
}

// A hill: a soft curve across the page, filled down to the page's bottom.
function hill(doc, baseY, rise, shift, color) {
  const { width, height } = doc.page;
  doc
    .moveTo(0, baseY)
    .bezierCurveTo(
      width * (0.25 + shift),
      baseY - rise,
      width * (0.55 + shift),
      baseY - rise * 0.9,
      width,
      baseY - rise * 0.15,
    )
    .lineTo(width, height)
    .lineTo(0, height)
    .closePath()
    .fill(color);
}

// A flame: a drop standing on (x, y), its tip leaning a little.
function flame(doc, x, y, w, h, lean, color) {
  doc
    .moveTo(x, y)
    .bezierCurveTo(x - w, y - h * 0.15, x - w * 0.7, y - h * 0.6, x + lean, y - h)
    .bezierCurveTo(x + w * 0.5, y - h * 0.6, x + w, y - h * 0.2, x, y)
    .fill(color);
}

// A log of the fire, tilted.
function log(doc, x, y, unit, angle, color) {
  doc.save();
  doc.translate(x, y).rotate(angle);
  doc.roundedRect(-34 * unit, -5 * unit, 68 * unit, 10 * unit, 5 * unit).fill(color);
  doc.restore();
}

// A note: its head, its stem, its flag.
function note(doc, x, y, size, color) {
  doc.save();
  doc.translate(x, y).rotate(-18);
  doc.ellipse(0, 0, size, size * 0.72).fill(color);
  doc.restore();
  const stem = x + size * 0.85;
  doc
    .moveTo(stem, y - size * 0.2)
    .lineTo(stem, y - size * 3.4)
    .lineWidth(size * 0.28)
    .strokeColor(color)
    .stroke();
  doc
    .moveTo(stem, y - size * 3.4)
    .bezierCurveTo(
      x + size * 2.4,
      y - size * 2.9,
      x + size * 2.2,
      y - size * 1.9,
      x + size * 1.7,
      y - size * 1.3,
    )
    .lineWidth(size * 0.3)
    .stroke();
}

// count: how many songs. diagrams: 'guitar', 'ukulele' or null.
// lastAdded: when the newest song came in - the book's "edition".
export function drawCover(doc, { count, diagrams, lastAdded }) {
  doc.addPage({ size: doc.options.size, margin: 0 });
  const { width, height } = doc.page;
  // Everything is measured for A4 and shrinks with the page.
  const unit = width / 595;
  const frame = () => doc.roundedRect(9 * MM, 9 * MM, width - 18 * MM, height - 18 * MM, 10);

  doc.rect(0, 0, width, height).fill(CREAM);

  // "Bódorgó" in the club's own letters, each in its colour of the logo -
  // drawn as letters, so it is sharp at any size.
  const letters = [...'BÓDORGÓ'];
  const logoSize = 78 * unit;
  doc.font('Logo').fontSize(logoSize);
  const gap = 2 * unit;
  const widths = letters.map((letter) => doc.widthOfString(letter));
  let x = (width - widths.reduce((sum, w) => sum + w + gap, -gap)) / 2;
  letters.forEach((letter, i) => {
    doc.fillColor(LOGO_LETTERS[i]).text(letter, x, height * 0.1, { lineBreak: false });
    x += widths[i] + gap;
  });

  const titleY = height * 0.3;
  centred(doc, 'DALOSKÖNYV', titleY, {
    font: 'Heading',
    size: 46 * unit,
    color: LOGO.darkGreen,
    characterSpacing: 4 * unit,
  });
  // A short rule with a dot in its middle.
  const ruleY = titleY + 68 * unit;
  doc
    .moveTo(width / 2 - 70 * unit, ruleY)
    .lineTo(width / 2 + 70 * unit, ruleY)
    .lineWidth(1)
    .strokeColor(RUST)
    .stroke();
  doc.circle(width / 2, ruleY, 3 * unit).fill(RUST);
  centred(doc, 'tábortűzhöz, gitárra, ukulelére', ruleY + 13 * unit, {
    font: 'Italic',
    size: 14 * unit,
    color: LOGO.brown,
  });

  // The evening, inside the frame: the sun going down behind the hills.
  const ground = height * 0.8;
  doc.save();
  frame().clip();
  doc.circle(width * 0.76, ground - 92 * unit, 46 * unit).fill(LOGO.yellow);
  hill(doc, ground - 30 * unit, 95 * unit, 0.18, '#a9d08f');
  hill(doc, ground, 70 * unit, -0.12, LOGO.green);
  hill(doc, ground + 52 * unit, 48 * unit, 0.3, LOGO.darkGreen);

  // The campfire, on the nearest hill.
  const fx = width * 0.36;
  const fy = ground + 34 * unit;
  log(doc, fx, fy, unit, -14, LOGO.brown);
  log(doc, fx, fy, unit, 14, '#6b4429');
  flame(doc, fx, fy - 2 * unit, 26 * unit, 78 * unit, 8 * unit, LOGO.red);
  flame(doc, fx - 3 * unit, fy - 2 * unit, 19 * unit, 58 * unit, -5 * unit, LOGO.orange);
  flame(doc, fx + 2 * unit, fy - 2 * unit, 11 * unit, 36 * unit, 3 * unit, LOGO.yellow);

  // The song, rising from the fire.
  note(doc, fx + 44 * unit, fy - 96 * unit, 6.5 * unit, LOGO.blue);
  note(doc, fx + 82 * unit, fy - 142 * unit, 8 * unit, LOGO.red);
  note(doc, fx + 30 * unit, fy - 178 * unit, 5.5 * unit, LOGO.orange);
  note(doc, fx + 118 * unit, fy - 208 * unit, 7 * unit, LOGO.brown);
  doc.restore();

  // A thin frame, like an old songbook's.
  frame().lineWidth(1.2).strokeColor('#c9a25a').stroke();

  // What is in it, and its edition: the day the newest song came in.
  const about = [`${count} dal`, DIAGRAM_LABEL[diagrams]].filter(Boolean).join(' · ');
  centred(doc, about, height - 33 * MM, { font: 'Heading', size: 12 * unit, color: CREAM });
  centred(doc, `Kiadás: ${huDate(lastAdded)}`, height - 26 * MM, {
    font: 'Body',
    size: 10.5 * unit,
    color: '#cfe3dc',
  });
}
