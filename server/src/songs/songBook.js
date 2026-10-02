import path from 'path';
import PDFDocument from 'pdfkit';
import { drawCover } from './songBookCover.js';
import { ANNEXES } from './songBookAnnexes.js';
import { chordShape, parseChordPro, toBlocks, toWords, uniqueChords } from './songText.js';

// The whole Daloskönyv as one PDF: a cover, the table of contents (every
// line a link to its song, with its page number), then the songs - each
// from a new page, the chords over their syllables, and (if asked) how the
// song's chords are held on the guitar or the ukulele -, and two annexes:
// the circle of fifths and the table of the keys' chords. Every page after
// the contents has a link back to it in its foot; the songs are in the
// PDF's bookmarks too.

// Same fonts as the other PDFs (assets/ - see sync.js): Mulish has the
// Hungarian ő and ű that pdfkit's built-in fonts lack.
const rootDir = path.resolve();
const FONT_REGULAR = path.join(rootDir, 'assets', 'fonts', 'Mulish-Regular.ttf');
const FONT_BOLD = path.join(rootDir, 'assets', 'fonts', 'Mulish-Bold.ttf');
const FONT_ITALIC = path.join(rootDir, 'assets', 'fonts', 'Mulish-Italic.ttf');
// The club's own letters (the site's "Bódorgó") - for the cover.
const FONT_LOGO = path.join(rootDir, 'assets', 'fonts', 'PotLand.ttf');

const INK = '#1f2d3a';
const GREY = '#56666e';
const LIGHT = '#9aa7ab';
const GREEN = '#1b6548';
// The chords: the same rust as on the song page.
const CHORD = '#b5533a';

const MM = 72 / 25.4;
const MARGIN = 15 * MM;
// Room under the text for the page number.
const BOTTOM = 18 * MM;

const TEXT_SIZE = 11;
const CHORD_SIZE = 9;
const TEXT_ROW = 14.5;
const CHORD_ROW = 10.5;
const VERSE_GAP = 9;
const CHORUS_INDENT = 12;
const TOC_ROW = 15.5;

export const BOOK_SIZES = ['A4', 'A5'];
export const BOOK_DIAGRAMS = ['guitar', 'ukulele'];

// songs: { title, artist, chordpro } in the book's order.
// diagrams: 'guitar', 'ukulele' or null. lastAdded: when the newest song
// came in - the cover's "edition". Answers the PDF as a Buffer.
export function renderSongBook(
  songs,
  { diagrams = null, size = 'A4', lastAdded = new Date() } = {},
) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size,
      margins: { top: MARGIN, bottom: BOTTOM, left: MARGIN, right: MARGIN },
      bufferPages: true,
      autoFirstPage: false,
      info: { Title: 'Bódorgó daloskönyv', Author: 'Bódorgó Klub' },
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('Body', FONT_REGULAR);
    doc.registerFont('Heading', FONT_BOLD);
    doc.registerFont('Italic', FONT_ITALIC);

    doc.registerFont('Logo', FONT_LOGO);

    drawCover(doc, { count: songs.length, diagrams, lastAdded });

    // What the contents list: the songs, and the annexes that close the
    // book (the circle of fifths, the keys' chords).
    const entries = [...songs, ...ANNEXES.map((annex) => ({ title: annex.title, artist: '' }))];

    // The contents come before the songs but need their page numbers:
    // its pages are added empty now, and filled in at the end.
    doc.addPage();
    doc.addNamedDestination('toc');
    doc.outline.addItem('Tartalom');
    const firstTocPage = pageIndex(doc);
    const perPage = Math.floor((contentBottom(doc) - MARGIN) / TOC_ROW);
    const perFirstPage = perPage - 3;
    const tocPages = 1 + Math.max(0, Math.ceil((entries.length - perFirstPage) / perPage));
    for (let i = 1; i < tocPages; i += 1) doc.addPage();

    const pages = entries.map((entry, i) => {
      doc.addPage();
      doc.addNamedDestination(`song-${i}`);
      doc.outline.addItem(entry.artist ? `${entry.title} – ${entry.artist}` : entry.title);
      const page = pageIndex(doc);
      if (i < songs.length) drawSong(doc, entry, diagrams);
      else ANNEXES[i - songs.length].draw(doc, { margin: MARGIN, bottom: contentBottom(doc) });
      return page;
    });

    drawContents(doc, entries, pages, { firstTocPage, perFirstPage, perPage });
    drawPageFeet(doc, firstTocPage + tocPages);
    doc.end();
  });
}

const pageIndex = (doc) => doc.bufferedPageRange().count - 1;
const contentBottom = (doc) => doc.page.height - BOTTOM;
const contentRight = (doc) => doc.page.width - MARGIN;

// One line of text exactly where it is put - never wrapped, never moving
// on to a new page by itself.
function put(doc, text, x, y, { font = 'Body', size = TEXT_SIZE, color = INK, ...options } = {}) {
  doc
    .font(font)
    .fontSize(size)
    .fillColor(color)
    .text(text, x, y, { lineBreak: false, ...options });
}

const widthOf = (doc, text, font, size) => doc.font(font).fontSize(size).widthOfString(text);

// --- A song ---

function drawSong(doc, song, diagrams) {
  const left = MARGIN;
  let y = MARGIN;

  doc.font('Heading').fontSize(18).fillColor(GREEN);
  const titleOptions = { width: contentRight(doc) - left };
  const titleHeight = doc.heightOfString(song.title, titleOptions);
  doc.text(song.title, left, y, titleOptions);
  y += titleHeight + 1;
  if (song.artist) {
    put(doc, song.artist, left, y, { font: 'Italic', size: 10.5, color: GREY });
    y += 15;
  }
  y += 9;

  const { lines } = parseChordPro(song.chordpro);
  if (diagrams) {
    const chords = lines.flatMap((l) =>
      l.type === 'lyrics' || l.type === 'chords-only' ? l.segments.map((s) => s.chord ?? '') : [],
    );
    y = drawDiagrams(doc, uniqueChords(chords), diagrams, y);
  }

  for (const block of toBlocks(lines)) {
    const indent = block.chorus ? CHORUS_INDENT : 0;
    const rows = block.lines.flatMap((line) => layoutLine(doc, line, left + indent));
    const height = rows.reduce((sum, row) => sum + row.height, 0);
    // A verse stays in one piece when it fits on a page at all.
    const pageHeight = contentBottom(doc) - MARGIN;
    if (y + height > contentBottom(doc) && height <= pageHeight && y > MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
    for (const row of rows) {
      if (y + row.height > contentBottom(doc)) {
        doc.addPage();
        y = MARGIN;
      }
      drawRow(doc, row, y);
      // The chorus: a line down its side.
      if (block.chorus) {
        doc
          .moveTo(left + 3, y)
          .lineTo(left + 3, y + row.height)
          .lineWidth(1.6)
          .strokeColor('#cfe3dc')
          .stroke();
      }
      y += row.height;
    }
    y += VERSE_GAP;
  }
}

// A line of the song as the rows it takes on the page: it wraps between
// words, and a word's pieces - each a chord over its text - stay together,
// so a chord never leaves its syllable (the page's twin of
// song-sheet.scss).
function layoutLine(doc, line, left) {
  if (line.type === 'comment') {
    return [{ comment: line.text, left, height: TEXT_ROW, pieces: [] }];
  }
  const right = contentRight(doc);
  const rows = [];
  let row = null;
  let x = left;
  const newRow = () => {
    row = { left, pieces: [], hasChords: false, height: TEXT_ROW };
    rows.push(row);
    x = left;
  };
  newRow();
  for (const word of toWords(line.segments)) {
    const pieces = word.map((piece) => {
      const textWidth = widthOf(doc, piece.text, 'Body', TEXT_SIZE);
      // A chord never touches the next one, even over a short syllable.
      const chordWidth = piece.chord ? widthOf(doc, piece.chord, 'Heading', CHORD_SIZE) + 4 : 0;
      return { ...piece, width: Math.max(textWidth, chordWidth) };
    });
    const width = pieces.reduce((sum, p) => sum + p.width, 0);
    if (x + width > right && row.pieces.length) newRow();
    for (const piece of pieces) {
      row.pieces.push({ ...piece, x });
      if (piece.chord) row.hasChords = true;
      x += piece.width;
    }
  }
  for (const r of rows) if (r.hasChords) r.height = TEXT_ROW + CHORD_ROW;
  return rows;
}

function drawRow(doc, row, y) {
  if (row.comment !== undefined) {
    put(doc, row.comment, row.left, y, { font: 'Italic', size: 10, color: GREY });
    return;
  }
  const textY = row.hasChords ? y + CHORD_ROW : y;
  for (const piece of row.pieces) {
    if (piece.chord) {
      put(doc, piece.chord, piece.x, y + 1, { font: 'Heading', size: CHORD_SIZE, color: CHORD });
    }
    if (piece.text.trim()) put(doc, piece.text, piece.x, textY);
  }
}

// --- Chord diagrams: the song's chords in a row under its title ---

const STRING_GAP = 6.4;
const FRET_GAP = 8.2;
const DIAGRAM_FRETS = 4;
const DIAGRAM_GAP = 13;
const NAME_HEIGHT = 11;
const MARKS_HEIGHT = 8;

function drawDiagrams(doc, chords, instrument, top) {
  const shapes = chords
    .map((name) => ({ name, shape: chordShape(name, instrument) }))
    .filter((c) => c.shape);
  if (!shapes.length) return top;
  const strings = shapes[0].shape.frets.length;
  const neck = (strings - 1) * STRING_GAP;
  // Room on the left for a fret number ("5.").
  const cell = neck + 12 + DIAGRAM_GAP;
  const rowHeight = NAME_HEIGHT + MARKS_HEIGHT + (DIAGRAM_FRETS + 1) * FRET_GAP + 8;
  let x = MARGIN;
  let y = top;
  for (const { name, shape } of shapes) {
    if (x + cell - DIAGRAM_GAP > contentRight(doc)) {
      x = MARGIN;
      y += rowHeight;
    }
    drawDiagram(doc, name, shape, x + 12, y, neck);
    x += cell;
  }
  return y + rowHeight + 6;
}

// The neck from above: strings down, frets across, a dot where a finger
// goes, ○ over an open string, × over one not played, a bar for a finger
// across several strings (the page's twin of chord-diagram.ts).
function drawDiagram(doc, name, shape, left, top, neck) {
  const held = shape.frets.filter((f) => f > 0);
  const highest = Math.max(0, ...held);
  // From the nut while it fits; otherwise from the lowest held fret.
  const base = highest <= DIAGRAM_FRETS ? 1 : Math.min(...held);
  const rows = Math.max(DIAGRAM_FRETS, highest - base + 1);
  const gridTop = top + NAME_HEIGHT + MARKS_HEIGHT;
  const x = (i) => left + i * STRING_GAP;
  const y = (fret) => gridTop + (fret - base + 0.5) * FRET_GAP;

  put(doc, name, left - 10, top, {
    font: 'Heading',
    size: 8.5,
    color: CHORD,
    width: neck + 20,
    align: 'center',
  });

  doc.lineWidth(0.5).strokeColor(LIGHT);
  for (let r = 0; r <= rows; r += 1) {
    doc
      .moveTo(left, gridTop + r * FRET_GAP)
      .lineTo(left + neck, gridTop + r * FRET_GAP)
      .stroke();
  }
  shape.frets.forEach((_, i) => {
    doc
      .moveTo(x(i), gridTop)
      .lineTo(x(i), gridTop + rows * FRET_GAP)
      .stroke();
  });
  if (base === 1) {
    doc
      .moveTo(left - 0.3, gridTop)
      .lineTo(left + neck + 0.3, gridTop)
      .lineWidth(1.8)
      .strokeColor(INK)
      .stroke();
  } else {
    put(doc, `${base}.`, left - 12, y(base) - 3.5, {
      font: 'Heading',
      size: 6.5,
      color: GREY,
      width: 9,
      align: 'right',
    });
  }

  const { barre } = shape;
  if (barre) {
    doc
      .roundedRect(
        x(barre.from) - 2.3,
        y(barre.fret) - 2.3,
        x(barre.to) - x(barre.from) + 4.6,
        4.6,
        2.3,
      )
      .fill(INK);
  }
  shape.frets.forEach((fret, i) => {
    const marksY = gridTop - 4;
    if (fret > 0) {
      const underBar = barre && fret === barre.fret && i >= barre.from && i <= barre.to;
      if (!underBar) doc.circle(x(i), y(fret), 2.4).fill(INK);
    } else if (fret === 0) {
      doc.circle(x(i), marksY, 1.6).lineWidth(0.6).strokeColor(INK).stroke();
    } else {
      doc
        .moveTo(x(i) - 1.5, marksY - 1.5)
        .lineTo(x(i) + 1.5, marksY + 1.5)
        .moveTo(x(i) + 1.5, marksY - 1.5)
        .lineTo(x(i) - 1.5, marksY + 1.5)
        .lineWidth(0.6)
        .strokeColor(GREY)
        .stroke();
    }
  });
}

// --- The table of contents ---

function drawContents(doc, songs, pages, { firstTocPage, perFirstPage, perPage }) {
  const left = MARGIN;
  songs.forEach((song, i) => {
    // Which of the contents' pages, and which row on it.
    const onFirst = i < perFirstPage;
    const page = onFirst ? 0 : 1 + Math.floor((i - perFirstPage) / perPage);
    const row = onFirst ? i + 3 : (i - perFirstPage) % perPage;
    doc.switchToPage(firstTocPage + page);
    if (i === 0) {
      put(doc, 'Tartalom', left, MARGIN, { font: 'Heading', size: 18, color: GREEN });
    }
    const right = contentRight(doc);
    const y = MARGIN + row * TOC_ROW;
    const number = String(pages[i] + 1);
    const numberWidth = widthOf(doc, number, 'Body', 10);
    const room = right - left - numberWidth - 14;

    // The title, and the artist after it while there is room.
    let title = song.title;
    while (title.length > 4 && widthOf(doc, title, 'Body', 10) > room) {
      title = `${title.slice(0, -2).trimEnd()}…`;
    }
    put(doc, title, left, y, { size: 10 });
    let end = left + widthOf(doc, title, 'Body', 10);
    const artist = song.artist ? ` – ${song.artist}` : '';
    if (artist && end + widthOf(doc, artist, 'Italic', 9) <= left + room) {
      put(doc, artist, end, y + 0.8, { font: 'Italic', size: 9, color: GREY });
      end += widthOf(doc, artist, 'Italic', 9);
    }
    // Dots leading to the page number.
    if (right - numberWidth - 6 > end + 6) {
      doc
        .moveTo(end + 5, y + 9.5)
        .lineTo(right - numberWidth - 5, y + 9.5)
        .lineWidth(0.6)
        .dash(0.6, { space: 2.6 })
        .strokeColor(LIGHT)
        .stroke()
        .undash();
    }
    put(doc, number, right - numberWidth, y, { size: 10 });
    // The whole row leads to the song.
    doc.goTo(left, y - 1, right - left, TOC_ROW, `song-${i}`);
  });
}

// The foot of every page but the cover: its number - and, from the first
// page after the contents on, the way back to the contents.
function drawPageFeet(doc, firstPageAfterContents) {
  const range = doc.bufferedPageRange();
  for (let i = range.start + 1; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    // Under the bottom margin - which would otherwise start a new page.
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 11 * MM;
    put(doc, String(i + 1), MARGIN, y, {
      size: 9,
      color: GREY,
      width: doc.page.width - MARGIN * 2,
      align: 'center',
    });
    if (i < firstPageAfterContents) continue;
    const back = '‹ Tartalom';
    const width = widthOf(doc, back, 'Heading', 9);
    put(doc, back, MARGIN, y, { font: 'Heading', size: 9, color: GREEN });
    // A finger-sized spot around the words.
    doc.goTo(MARGIN - 6, y - 8, width + 12, 26, 'toc');
  }
}
