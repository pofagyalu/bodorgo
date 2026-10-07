// Builds the one-page guide attached to the invitation e-mail
// (src/utils/installGuide.js): "Bódorgó a telefonodon" - how to put the
// app on a phone's home screen, Android and iPhone side by side, from the
// screenshots in ../install-screens (not in the repo).
//
//   node scripts/buildInstallGuide.mjs
//
// Writes assets/guides/bodorgo-telepites.pdf - commit it; `npm run build`
// ships assets/ to the live server.
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';

const root = path.resolve();
const SHOTS = path.join(root, '..', 'install-screens');
const OUT = path.join(root, 'assets', 'guides', 'bodorgo-telepites.pdf');
const font = (name) => path.join(root, 'assets', 'fonts', name);

const GREEN = '#1b6548';
const ORANGE = '#f07827';
const INK = '#203747';
const GREY = '#56666e';

// The page (A4, in points) and the grid on it: two columns, each two
// pictures wide.
const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 34;
const COLUMN_GAP = 24;
const CELL_GAP = 10;
const COLUMN = (PAGE.width - 2 * MARGIN - COLUMN_GAP) / 2;
const CELL = (COLUMN - CELL_GAP) / 2;
const PICTURE = { width: CELL, height: (CELL * 190) / 122 };
const CAPTION = 50;

// A step's picture: the part of the screenshot that matters (`crop`: left,
// top, width - its height follows the cell's shape), and what to tap,
// ringed (`mark`: left, top, width, height) - all in the screenshot's own
// pixels.
const ANDROID = [
  {
    file: 'android/Screenshot_20261007_205523_Chrome.jpg',
    crop: [0, 0, 1080],
    mark: [945, 108, 132, 132],
    text: 'Nyisd meg a bodorgo.hu oldalt Chrome-ban, és koppints jobb felül a három pöttyre.',
  },
  {
    file: 'android/Screenshot_20261007_205551_Chrome.jpg',
    crop: [290, 760, 780],
    mark: [320, 1338, 720, 128],
    text: 'Válaszd az „Install and create shortcut” sort (magyarul: Telepítés…).',
  },
  {
    file: 'android/Screenshot_20261007_205608_Chrome.jpg',
    crop: [0, 658, 1080],
    mark: [72, 1752, 936, 186],
    // This phone had the app already: its first row said so. Written over
    // with what a phone without it shows.
    rewrite: {
      cover: [236, 1772, 640, 146],
      sample: [860, 1790],
      lines: [
        { text: 'Install', x: 254, y: 1830, size: 44, color: '#ffffff' },
        { text: 'Apps open in their own window', x: 254, y: 1894, size: 37, color: '#e3e3e3' },
      ],
    },
    text: 'A megjelenő ablakban koppints az „Install” (Telepítés) sorra, és hagyd jóvá.',
  },
  {
    file: 'android/Screenshot_20261007_205646_One UI Home.jpg',
    crop: [380, 150, 700],
    mark: [806, 400, 216, 280],
    text: 'Kész! A Bódorgó ikonja ott van a kezdőképernyőn - innen indítsd.',
  },
];

const IPHONE = [
  {
    file: 'iphone/IMG_4565.png',
    crop: [0, 710, 1170],
    mark: [278, 2292, 132, 132],
    text: 'Nyisd meg a bodorgo.hu oldalt Safariban, és koppints a címsor bal szélén a menü ikonra.',
  },
  {
    file: 'iphone/IMG_4566.png',
    crop: [230, 830, 780],
    mark: [296, 900, 668, 126],
    text: 'Válaszd: „Share” (magyar telefonon: Megosztás).',
  },
  {
    file: 'iphone/IMG_4567.png',
    crop: [0, 520, 900],
    mark: [68, 1560, 820, 140],
    text: 'Válaszd: „Add to Home Screen” (Főképernyőhöz adás), majd jobb felül „Add” (Hozzáadás).',
  },
  {
    file: 'iphone/IMG_4568.png',
    crop: [0, 100, 700],
    mark: [62, 180, 236, 290],
    text: 'Kész! A Bódorgó ikonja ott van a főképernyőn - innen indítsd.',
  },
];

// The step's picture as a JPEG: cut out, its target ringed in orange.
async function picture(step) {
  let shot = sharp(path.join(SHOTS, step.file));
  if (step.rewrite) {
    const { cover, sample, lines } = step.rewrite;
    const { data } = await sharp(path.join(SHOTS, step.file))
      .extract({ left: sample[0], top: sample[1], width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const fill = `rgb(${data[0]},${data[1]},${data[2]})`;
    const { width, height } = await shot.metadata();
    const text = lines
      .map(
        (l) =>
          `<text x="${l.x}" y="${l.y}" font-family="Roboto, 'Segoe UI', Arial, sans-serif" font-size="${l.size}" fill="${l.color}">${l.text}</text>`,
      )
      .join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="${cover[0]}" y="${cover[1]}" width="${cover[2]}" height="${cover[3]}" fill="${fill}"/>${text}</svg>`;
    shot = sharp(await shot.composite([{ input: Buffer.from(svg) }]).toBuffer());
  }

  const [left, top, width] = step.crop;
  const height = Math.round((width * PICTURE.height) / PICTURE.width);
  const [mx, my, mw, mh] = step.mark;
  const stroke = Math.round(width / 70);
  const ring = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="${mx - left}" y="${my - top}" width="${mw}" height="${mh}" rx="${Math.min(mw, mh) / 2.6}" fill="none" stroke="${ORANGE}" stroke-width="${stroke}"/></svg>`;
  // (In two goes: sharp resizes before it composites.)
  const ringed = await sharp(await shot.extract({ left, top, width, height }).toBuffer())
    .composite([{ input: Buffer.from(ring) }])
    .toBuffer();
  return sharp(ringed).resize({ width: 520 }).jpeg({ quality: 82 }).toBuffer();
}

async function drawColumn(doc, title, subtitle, steps, x, top) {
  doc.font('Heading').fontSize(15).fillColor(GREEN).text(title, x, top, { lineBreak: false });
  const titleWidth = doc.widthOfString(title);
  doc
    .font('Body')
    .fontSize(10)
    .fillColor(GREY)
    .text(subtitle, x + titleWidth + 7, top + 4.5, { lineBreak: false });
  doc
    .moveTo(x, top + 23)
    .lineTo(x + COLUMN, top + 23)
    .lineWidth(1)
    .strokeColor('#cfe3dc')
    .stroke();

  const gridTop = top + 34;
  for (const [i, step] of steps.entries()) {
    const cx = x + (i % 2) * (CELL + CELL_GAP);
    const cy = gridTop + Math.floor(i / 2) * (PICTURE.height + CAPTION + 12);
    doc.save();
    doc.roundedRect(cx, cy, PICTURE.width, PICTURE.height, 9).clip();
    doc.image(await picture(step), cx, cy, { width: PICTURE.width, height: PICTURE.height });
    doc.restore();
    doc
      .roundedRect(cx, cy, PICTURE.width, PICTURE.height, 9)
      .lineWidth(0.8)
      .strokeColor('#c9d3cf')
      .stroke();

    // The step's number in a green disc, its text beside it.
    const textTop = cy + PICTURE.height + 8;
    doc.circle(cx + 8, textTop + 7, 8).fill(GREEN);
    doc
      .font('Heading')
      .fontSize(9.5)
      .fillColor('#ffffff')
      .text(String(i + 1), cx, textTop + 1.6, { width: 16, align: 'center', lineBreak: false });
    doc
      .font('Body')
      .fontSize(8.6)
      .fillColor(INK)
      .text(step.text, cx + 21, textTop, { width: PICTURE.width - 21, lineGap: 0.6 });
  }
  return gridTop + 2 * (PICTURE.height + CAPTION + 12);
}

const doc = new PDFDocument({
  size: 'A4',
  margin: 0,
  info: { Title: 'Bódorgó a telefonodon', Author: 'Bódorgó klub' },
});
doc.registerFont('Body', font('Mulish-Regular.ttf'));
doc.registerFont('Heading', font('Mulish-Bold.ttf'));
doc.registerFont('Title', font('Marhey-Bold.ttf'));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const done = new Promise((resolve) => doc.pipe(fs.createWriteStream(OUT)).on('finish', resolve));

// The head: the logo, the title, a sentence on what this is.
const logoWidth = 150;
doc.image(path.join(root, 'assets', 'img', 'logo.png'), MARGIN, MARGIN - 4, { width: logoWidth });
doc
  .font('Title')
  .fontSize(21)
  .fillColor(GREEN)
  .text('Bódorgó a telefonodon', MARGIN + logoWidth + 18, MARGIN, { lineBreak: false });
doc
  .font('Body')
  .fontSize(10.2)
  .fillColor(INK)
  .text(
    'A bodorgo.hu-t kiteheted a telefonod kezdőképernyőjére: onnantól saját ikonja van, teljes képernyőn nyílik meg, és úgy működik, mint egy alkalmazás. Nem kell hozzá áruház, egy perc az egész.',
    MARGIN,
    MARGIN + 46,
    { width: PAGE.width - 2 * MARGIN, lineGap: 1.5 },
  );

const top = MARGIN + 88;
const bottom = await drawColumn(doc, 'Android', 'Chrome böngészőben', ANDROID, MARGIN, top);
await drawColumn(doc, 'iPhone', 'Safari böngészőben', IPHONE, MARGIN + COLUMN + COLUMN_GAP, top);
// Between the two columns.
doc
  .moveTo(PAGE.width / 2, top)
  .lineTo(PAGE.width / 2, bottom - 14)
  .lineWidth(0.6)
  .strokeColor('#dfe7e3')
  .stroke();

// The foot: what else is worth knowing.
const notes = [
  'A képek angol nyelvű telefonokról készültek - magyar telefonon ugyanott, magyar néven találod a menüpontokat.',
  'iPhone-on csak Safariból megy. Régebbi iPhone-on a Megosztás gomb (négyzet, benne felfelé mutató nyíl) rögtön a képernyő alján van.',
  'Belépés után érdemes engedélyezni az értesítéseket, hogy ne maradj le a Kotyogó üzeneteiről.',
];
const boxTop = bottom - 2;
const boxWidth = PAGE.width - 2 * MARGIN;
doc.font('Body').fontSize(9);
const noteHeights = notes.map((n) => doc.heightOfString(n, { width: boxWidth - 44, lineGap: 1 }));
const boxHeight = noteHeights.reduce((sum, h) => sum + h + 5, 0) + 33;
doc.roundedRect(MARGIN, boxTop, boxWidth, boxHeight, 10).fill('#edf4f1');
doc
  .font('Heading')
  .fontSize(10.5)
  .fillColor(GREEN)
  .text('Jó tudni', MARGIN + 14, boxTop + 11, { lineBreak: false });
let y = boxTop + 29;
notes.forEach((note, i) => {
  doc.circle(MARGIN + 19, y + 5.5, 1.8).fill(ORANGE);
  doc
    .font('Body')
    .fontSize(9)
    .fillColor(INK)
    .text(note, MARGIN + 30, y, { width: boxWidth - 44, lineGap: 1 });
  y += noteHeights[i] + 5;
});

doc
  .font('Body')
  .fontSize(8)
  .fillColor(GREY)
  .text('Bódorgó klub · bodorgo.hu', MARGIN, PAGE.height - MARGIN - 4, {
    width: boxWidth,
    align: 'center',
    lineBreak: false,
  });

doc.end();
await done;
console.log(`✓ ${path.relative(root, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} kB)`);
console.log(
  `  foot of the notes at ${Math.round(boxTop + boxHeight)} of ${Math.round(PAGE.height)}`,
);
