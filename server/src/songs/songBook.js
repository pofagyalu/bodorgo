import path from 'path';
import PDFDocument from 'pdfkit';
import { drawCover } from './songBookCover.js';
import { ANNEXES } from './songBookAnnexes.js';
import {
  NOTATION,
  annotationText,
  chordNamePieces,
  keyName,
  parseChord,
  parseChordPro,
  shapeFinder,
  songKey,
  toBlocks,
  toWords,
  withoutScreenChords,
  transposeChordPro,
  transposeKey,
  uniqueChords,
} from './songText.js';

// The whole Daloskönyv as one PDF: a cover, the table of contents (every
// line a link to its song, with its page number), then the songs - each
// from a new page, the chords over their syllables, and (if asked) how the
// song's chords are held on the guitar or the ukulele: down the right of
// the page beside the words where the song's lines leave that room, in a
// strip above them otherwise -, two annexes (the
// circle of fifths and the table of the keys' chords), and last an index:
// the songs once more, grouped by their artists, each a link to its song.
// Every page after the contents has a link back to it in its foot; the
// songs are in the PDF's bookmarks too.

// Same fonts as the other PDFs (assets/ - see sync.js): Mulish has the
// Hungarian ő and ű that pdfkit's built-in fonts lack.
const rootDir = path.resolve();
const FONT_REGULAR = path.join(rootDir, 'assets', 'fonts', 'Mulish-Regular.ttf');
const FONT_BOLD = path.join(rootDir, 'assets', 'fonts', 'Mulish-Bold.ttf');
const FONT_ITALIC = path.join(rootDir, 'assets', 'fonts', 'Mulish-Italic.ttf');
// The club's own letters (the site's "Bódorgó") - for the cover.
const FONT_LOGO = path.join(rootDir, 'assets', 'fonts', 'PotLand.ttf');
// The site's menu letters (Marhey) - for the cover's title.
const FONT_TITLE = path.join(rootDir, 'assets', 'fonts', 'Marhey-Bold.ttf');

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

// The words' size (pt): never smaller than this, and as much bigger - up to
// TEXT_SIZE_MAX - as a song has room for on its page (fitSong below). A
// short song is printed large enough to read by a campfire; a long one
// keeps to its page.
const TEXT_SIZE = 11;
const TEXT_SIZE_MAX = 14;
const TEXT_SIZE_STEP = 0.5;

// What follows the words' size, in the proportions they have at 11: the
// chords over the words, a row of words, the row of chords over it, the
// gap between two verses.
const sizes = (text) => {
  const scale = text / TEXT_SIZE;
  return {
    text,
    chord: 9 * scale,
    textRow: 14.5 * scale,
    chordRow: 10.5 * scale,
    verseGap: 9 * scale,
    tab: TAB_SIZE * scale,
  };
};

// A guitar tab's lines ({start_of_tab} - see the client's chordpro.ts): in
// letters of one width, so the strings stay under each other. pdfkit's own
// Courier - every letter 0.6 of its size wide - which knows no ő and ű:
// those are written as ö and ü in a tab's rare word.
const TAB_FONT = 'Courier';
const TAB_SIZE = 8.5;
const TAB_ROW = 1.18; // a row's height, in sizes
const TAB_LETTER = 0.6;
const TAB_SIZE_MIN = 5;
const tabText = (text) =>
  text.replace(/[őŐűŰ]/g, (c) => ({ ő: 'ö', Ő: 'Ö', ű: 'ü', Ű: 'Ü' })[c]).replace(/\t/g, '    ');
// One line of a tab as a row: at the tab's size, or as much smaller as it
// takes for the line to end before `right` (never wrapped - its place
// under the other strings is all it says).
function tabRow(text, left, m, right) {
  const line = tabText(text);
  const fits = (right - left) / (Math.max(line.length, 1) * TAB_LETTER);
  const size = Math.max(TAB_SIZE_MIN, Math.min(m.tab, fits));
  return { tab: line, size, left, height: size * TAB_ROW, pieces: [] };
}
const CHORUS_INDENT = 12;
const TOC_ROW = 15.5;

export const BOOK_SIZES = ['A4', 'A5'];
export const BOOK_DIAGRAMS = ['guitar', 'ukulele'];

// An empty book with its fonts; resolve gets the finished PDF (a Buffer)
// once doc.end() is called.
function newBook(size, resolve, reject) {
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
  doc.registerFont('Title', FONT_TITLE);
  return doc;
}

// The cover alone, as a one-page PDF - for the book's small picture
// (songController.js), without drawing the whole book for it. All the
// cover says: how many songs, whose diagrams, when the newest came in.
export function renderSongBookCover({ count, diagrams = null, lastAdded = new Date() }) {
  return new Promise((resolve, reject) => {
    const doc = newBook('A4', resolve, reject);
    drawCover(doc, { count, diagrams, lastAdded });
    doc.end();
  });
}

// One song alone, as its page of the book - no cover, no contents: its
// title, artist and key, how its chords are held (if asked), the lyrics
// with the chords over them. transpose: semitones to move it by first (the
// way the song page shows it at that transposition - its chords spelled
// for the new key, a key set by hand moved along). A long song's pages are
// numbered "1 / 2".
export function renderSongPdf(song, { diagrams = null, size = 'A4', transpose = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const doc = newBook(size, resolve, reject);
    doc.info.Title = song.title;
    const home = songKey(song);
    const moved = transpose
      ? {
          ...song,
          chordpro: transposeChordPro(song.chordpro, transpose, NOTATION, home || undefined),
          key: song.key ? transposeKey(song.key, transpose) : '',
        }
      : song;
    doc.addPage();
    // Moved to another key, the song's own shapes ({define}) are other
    // chords' - the songbook's are drawn, as on the song page.
    drawSong(doc, moved, diagrams, { ownShapes: !transpose });

    const { count } = doc.bufferedPageRange();
    for (let i = 0; count > 1 && i < count; i += 1) {
      doc.switchToPage(i);
      // Under the bottom margin - which would otherwise start a new page.
      doc.page.margins.bottom = 0;
      put(doc, `${i + 1} / ${count}`, MARGIN, doc.page.height - 11 * MM, {
        size: 9,
        color: GREY,
        width: doc.page.width - MARGIN * 2,
        align: 'center',
      });
    }
    doc.end();
  });
}

// songs: { title, artist, chordpro } in the book's order.
// diagrams: 'guitar', 'ukulele' or null. lastAdded: when the newest song
// came in - the cover's "edition". Answers the PDF as a Buffer.
export function renderSongBook(
  songs,
  { diagrams = null, size = 'A4', lastAdded = new Date() } = {},
) {
  return new Promise((resolve, reject) => {
    const doc = newBook(size, resolve, reject);
    drawCover(doc, { count: songs.length, diagrams, lastAdded });

    // What the contents list: the songs, and - under their own heading -
    // the annexes that close the book (the circle of fifths, the keys'
    // chords).
    // And last the index: the songs once more, grouped by their artists.
    const entries = [
      ...songs,
      { heading: 'Mellékletek' },
      ...ANNEXES.map((annex) => ({ title: annex.title, artist: '', draw: annex.draw })),
      { heading: 'Mutató' },
      { title: ARTIST_INDEX_TITLE, artist: '', index: true },
    ];

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

    // Each entry's page - filled as the pages come, so the index at the
    // end already knows where the songs are.
    const pages = [];
    entries.forEach((entry, i) => {
      // A heading of the contents has no page of its own.
      if (entry.heading) {
        pages.push(null);
        return;
      }
      doc.addPage();
      doc.addNamedDestination(`song-${i}`);
      doc.outline.addItem(entry.artist ? `${entry.title} – ${entry.artist}` : entry.title);
      pages.push(pageIndex(doc));
      if (entry.index) drawArtistIndex(doc, songs, pages);
      else if (entry.draw) entry.draw(doc, { margin: MARGIN, bottom: contentBottom(doc) });
      else drawSong(doc, entry, diagrams);
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

// A chord's name is written with its numbers as indexes - raised and
// smaller: F⁷, Gsus², am⁷/G (the page's twin of the client's chord-name).
const INDEX_SCALE = 0.68;

const chordNameWidth = (doc, name, size) =>
  chordNamePieces(name).reduce(
    (sum, piece) =>
      sum + widthOf(doc, piece.text, 'Heading', piece.index ? size * INDEX_SCALE : size),
    0,
  );

// From x on, its top at y. The smaller numbers start a touch under that
// top: raised to the capitals' height, no higher - they belong to their
// chord, not to the line above.
function putChordName(doc, name, x, y, { size, color }) {
  let at = x;
  for (const piece of chordNamePieces(name)) {
    const pieceSize = piece.index ? size * INDEX_SCALE : size;
    put(doc, piece.text, at, piece.index ? y + size * 0.04 : y, {
      font: 'Heading',
      size: pieceSize,
      color,
    });
    at += widthOf(doc, piece.text, 'Heading', pieceSize);
  }
}

// --- A song ---

function drawSong(doc, song, diagrams, { ownShapes = true } = {}) {
  const left = MARGIN;
  let y = MARGIN;

  doc.font('Heading').fontSize(18).fillColor(GREEN);
  const titleOptions = { width: contentRight(doc) - left };
  const titleHeight = doc.heightOfString(song.title, titleOptions);
  doc.text(song.title, left, y, titleOptions);
  y += titleHeight + 1;
  // Under the title: the artist, and after it the song's key (the one set
  // by hand, or what its chords say) in a quiet tag - "a-moll".
  const key = keyName(songKey(song));
  // And after the key the tempo, where one was given: a drawn quarter note
  // and "= 96".
  if (song.artist || key || song.tempo) {
    let x = left;
    if (song.artist) {
      put(doc, song.artist, x, y, { font: 'Italic', size: 10.5, color: GREY });
      x += widthOf(doc, song.artist, 'Italic', 10.5) + 8;
    }
    if (key) {
      const width = widthOf(doc, key, 'Heading', 8.5) + 10;
      doc.roundedRect(x, y + 0.5, width, 12.5, 6.25).fill('#e8f3ee');
      put(doc, key, x + 5, y + 2.2, { font: 'Heading', size: 8.5, color: GREEN });
      x += width + 8;
    }
    if (song.tempo) {
      // The note: a slanted head and its stem (the fonts have no ♩).
      doc.save();
      doc.rotate(-20, { origin: [x + 2.6, y + 10] });
      doc.ellipse(x + 2.6, y + 10, 2.6, 1.9).fill(GREY);
      doc.restore();
      doc
        .moveTo(x + 5, y + 9.4)
        .lineTo(x + 5, y + 1.5)
        .lineWidth(0.8)
        .stroke(GREY);
      put(doc, `= ${song.tempo}`, x + 8.5, y + 2.2, { font: 'Heading', size: 8.5, color: GREY });
    }
    y += 15;
  }
  y += 9;

  const { lines, defines } = parseChordPro(song.chordpro);
  // From a {screen} mark on (to the song's end, or to a {print}) the lines
  // are printed with their words alone: those chords are for the song
  // page, where the first verse scrolls out of sight.
  const blocks = withoutScreenChords(toBlocks(lines));
  const chords = lines.flatMap((l) =>
    l.type === 'lyrics' || l.type === 'chords-only' ? l.segments.map((s) => s.chord ?? '') : [],
  );
  const shapes = diagrams
    ? diagramShapes(uniqueChords(chords), diagrams, ownShapes ? defines : [])
    : [];

  const plan = fitSong(doc, blocks, shapes, y);
  // How the chords are held: down the right side of the page beside the
  // words, or in a strip above them (planSong says which).
  if (plan.column) drawDiagramColumn(doc, shapes, plan.column, y);
  else drawDiagrams(doc, shapes, y);

  let page = 0;
  for (const { row, chorus, ...at } of plan.rows) {
    for (; page < at.page; page += 1) doc.addPage();
    drawRow(doc, row, at.y, plan.sizes);
    // The chorus: a line down its side.
    if (chorus) {
      doc
        .moveTo(left + 3, at.y)
        .lineTo(left + 3, at.y + row.height)
        .lineWidth(1.6)
        .strokeColor('#cfe3dc')
        .stroke();
    }
  }
}

// Where everything of a song goes at one size of the words, without
// drawing any of it: the diagrams - in a column down the right of the
// page, beside the words, where every line leaves that room (the words
// rarely pass the middle of the page, and a strip of diagrams above them
// costs the song four or five lines), in the strip above the words
// otherwise -, and every row of the song with its page and its place on
// it. `top`: where the song's own part starts, under its heading.
function planSong(doc, blocks, shapes, top, m) {
  const left = MARGIN;
  let y = top;
  let column = diagramColumn(doc, shapes, top);
  // Beside the words only where the longest line leaves it room.
  if (column && widestLine(doc, blocks, left, m) > column.left - DIAGRAM_GUTTER - left) {
    column = null;
  }
  if (!column) y = top + diagramStripHeight(doc, shapes);

  const rows = [];
  let page = 0;
  const bottom = contentBottom(doc);
  for (const block of blocks) {
    const indent = block.chorus ? CHORUS_INDENT : 0;
    const blockRows = block.lines.flatMap((line) => layoutLine(doc, line, left + indent, m));
    const height = blockRows.reduce((sum, row) => sum + row.height, 0);
    // A verse stays in one piece when it fits on a page at all.
    if (y + height > bottom && height <= bottom - MARGIN && y > MARGIN) {
      page += 1;
      y = MARGIN;
    }
    for (const row of blockRows) {
      if (y + row.height > bottom) {
        page += 1;
        y = MARGIN;
      }
      rows.push({ row, chorus: block.chorus, page, y });
      y += row.height;
    }
    y += m.verseGap;
  }
  return { sizes: m, column, rows, pages: page + 1 };
}

// The song planned at the largest size of the words it has room for: as
// big as TEXT_SIZE_MAX, as long as it takes no more pages than at the
// smallest size, and no line that stood on one row there is broken in two.
function fitSong(doc, blocks, shapes, top) {
  const smallest = planSong(doc, blocks, shapes, top, sizes(TEXT_SIZE));
  for (let size = TEXT_SIZE_MAX; size > TEXT_SIZE; size -= TEXT_SIZE_STEP) {
    const plan = planSong(doc, blocks, shapes, top, sizes(size));
    if (plan.pages <= smallest.pages && plan.rows.length <= smallest.rows.length) return plan;
  }
  return smallest;
}

// A line of the song as the rows it takes on the page: it wraps between
// words, and a word's pieces - each a chord over its text - stay together,
// so a chord never leaves its syllable (the page's twin of
// song-sheet.scss). m: the sizes it is set in.
function layoutLine(doc, line, left, m, right = contentRight(doc)) {
  if (line.type === 'comment') {
    return [{ comment: line.text, left, height: m.textRow, pieces: [] }];
  }
  if (line.type === 'tab') return [tabRow(line.text, left, m, right)];
  const rows = [];
  let row = null;
  let x = left;
  const newRow = () => {
    row = { left, pieces: [], hasChords: false, height: m.textRow };
    rows.push(row);
    x = left;
  };
  newRow();
  for (const word of toWords(line.segments)) {
    const pieces = word.map((piece) => {
      const textWidth = widthOf(doc, piece.text, 'Body', m.text);
      // A chord never touches the next one, even over a short syllable.
      const chordWidth = piece.chord
        ? chordNameWidth(doc, shownChord(piece.chord), m.chord) + 4
        : 0;
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
  // A line of chords or labels with no words ("[Intro]", "[C] [G]") is
  // that one row alone - no empty line of text under it, so it sits right
  // on the verse it belongs to.
  const chordsOnly = line.type === 'chords-only';
  for (const r of rows) {
    if (r.hasChords) r.height = chordsOnly ? m.chordRow + 3 : m.textRow + m.chordRow;
  }
  return rows;
}

// What is written for what stands in [brackets]: an annotation's text
// without its star, anything else as it is.
const shownChord = (name) => annotationText(name) ?? name;

// A comment's size beside words of this size.
const commentSize = (m) => (10 * m.text) / TEXT_SIZE;

function drawRow(doc, row, y, m) {
  if (row.comment !== undefined) {
    put(doc, row.comment, row.left, y, { font: 'Italic', size: commentSize(m), color: GREY });
    return;
  }
  if (row.tab !== undefined) {
    if (row.tab.trim()) put(doc, row.tab, row.left, y, { font: TAB_FONT, size: row.size });
    return;
  }
  const textY = row.hasChords ? y + m.chordRow : y;
  for (const piece of row.pieces) {
    if (piece.chord) {
      // In brackets but not a chord ("Intro", "2x"): a quiet label.
      // An annotation ("[*/]") is written like a chord, without its star.
      if (parseChord(piece.chord) || annotationText(piece.chord) !== null) {
        putChordName(doc, shownChord(piece.chord), piece.x, y + 1, {
          size: m.chord,
          color: CHORD,
        });
      } else {
        put(doc, piece.chord, piece.x, y + 1, { font: 'Italic', size: m.chord, color: GREY });
      }
    }
    if (piece.text.trim()) put(doc, piece.text, piece.x, textY, { size: m.text });
  }
}

// --- Chord diagrams: the song's chords in a row under its title ---

const STRING_GAP = 6.4;
const FRET_GAP = 8.2;
const DIAGRAM_FRETS = 4;
const DIAGRAM_GAP = 13;
const NAME_HEIGHT = 11;
// A dot's radius: room for a finger's number in it.
const DOT = 3;
const FINGER_SIZE = 4.6;
const MARKS_HEIGHT = 8;

// Between the words and the column of diagrams beside them.
const DIAGRAM_GUTTER = 14;
// The column may take this much of the page's width at most - more chords
// than that go above the words.
const DIAGRAM_COLUMN_SHARE = 0.4;

// The chords that have a diagram on this instrument, with how each is
// held - the song's own way ({define}) for the ones it gives.
const diagramShapes = (chords, instrument, defines) => {
  const shapeOf = shapeFinder(defines, instrument);
  return chords.map((name) => ({ name, shape: shapeOf(name) })).filter((c) => c.shape);
};

// How many times the measures above the diagrams are drawn: one size all
// through the book - in the column and in the strip, on every page.
const DIAGRAM_SCALE = 1.3;

// A diagram's place: the neck's width (at its own size - see placeDiagram),
// the cell it stands in (with room on its left for a fret number, "5."),
// and a row's height.
function diagramCell(shapes) {
  const neck = (shapes[0].shape.frets.length - 1) * STRING_GAP;
  return {
    neck,
    cell: (neck + 12) * DIAGRAM_SCALE + DIAGRAM_GAP,
    rowHeight: (NAME_HEIGHT + MARKS_HEIGHT + (DIAGRAM_FRETS + 1) * FRET_GAP + 8) * DIAGRAM_SCALE,
  };
}

// A diagram with its cell's top left corner at (x, y): drawn at its own
// size on a sheet stretched DIAGRAM_SCALE times.
function placeDiagram(doc, name, shape, x, y, neck) {
  doc.save();
  doc.translate(x, y).scale(DIAGRAM_SCALE);
  drawDiagram(doc, name, shape, 12, 0, neck);
  doc.restore();
}

// The column the diagrams would stand in down the right of the page, from
// `top` to the page's foot: how many per column, how many columns side by
// side, and where the column starts. null where there are no diagrams, or
// too many for a column that leaves the words their room.
function diagramColumn(doc, shapes, top) {
  if (!shapes.length) return null;
  const { cell, rowHeight } = diagramCell(shapes);
  const perColumn = Math.floor((contentBottom(doc) - top) / rowHeight);
  if (perColumn < 1) return null;
  const columns = Math.ceil(shapes.length / perColumn);
  const width = columns * cell - DIAGRAM_GAP;
  if (width > (contentRight(doc) - MARGIN) * DIAGRAM_COLUMN_SHARE) return null;
  return { perColumn, columns, left: contentRight(doc) - width };
}

// The diagrams one under the other, in the order the chords come in the
// song; a column that is full is followed by one on its right.
function drawDiagramColumn(doc, shapes, column, top) {
  const { neck, cell, rowHeight } = diagramCell(shapes);
  shapes.forEach(({ name, shape }, i) => {
    const x = column.left + Math.floor(i / column.perColumn) * cell;
    const y = top + (i % column.perColumn) * rowHeight;
    placeDiagram(doc, name, shape, x, y, neck);
  });
}

// How far the song's longest line reaches from the left margin, set on one
// row: its words with the chords over them, a chorus with its indent.
function widestLine(doc, blocks, left, m) {
  let widest = 0;
  for (const block of blocks) {
    const start = left + (block.chorus ? CHORUS_INDENT : 0);
    for (const line of block.lines) {
      if (line.type === 'comment') {
        const width = widthOf(doc, line.text, 'Italic', commentSize(m));
        widest = Math.max(widest, start - left + width);
        continue;
      }
      if (line.type === 'tab') {
        const width = tabText(line.text).length * TAB_LETTER * m.tab;
        widest = Math.max(widest, start - left + width);
        continue;
      }
      const [row] = layoutLine(doc, line, start, m, Infinity);
      const last = row.pieces[row.pieces.length - 1];
      if (last) widest = Math.max(widest, last.x + last.width - left);
    }
  }
  return widest;
}

// How much of the page the strip of diagrams above the words takes (0
// without diagrams) - what drawDiagrams below uses up.
function diagramStripHeight(doc, shapes) {
  if (!shapes.length) return 0;
  const { cell, rowHeight } = diagramCell(shapes);
  const perRow = Math.max(1, Math.floor((contentRight(doc) - MARGIN + DIAGRAM_GAP) / cell));
  return Math.ceil(shapes.length / perRow) * rowHeight + 6;
}

// The diagrams in a strip above the words, row after row.
function drawDiagrams(doc, shapes, top) {
  if (!shapes.length) return top;
  const { neck, cell, rowHeight } = diagramCell(shapes);
  let x = MARGIN;
  let y = top;
  for (const { name, shape } of shapes) {
    if (x + cell - DIAGRAM_GAP > contentRight(doc)) {
      x = MARGIN;
      y += rowHeight;
    }
    placeDiagram(doc, name, shape, x, y, neck);
    x += cell;
  }
  return y + rowHeight + 6;
}

// The neck from above: strings down, frets across, a dot where a finger
// goes (the finger's number in it, where the song says which), ○ over an
// open string, × over one not played, a bar for a finger across several
// strings (the page's twin of chord-diagram.ts).
function drawDiagram(doc, name, shape, left, top, neck) {
  const held = shape.frets.filter((f) => f > 0);
  const highest = Math.max(0, ...held);
  // From the nut while it fits; otherwise from the lowest held fret -
  // unless the shape says where itself.
  const base = shape.base ?? (highest <= DIAGRAM_FRETS ? 1 : Math.min(...held));
  const rows = Math.max(DIAGRAM_FRETS, highest - base + 1);
  const gridTop = top + NAME_HEIGHT + MARKS_HEIGHT;
  const x = (i) => left + i * STRING_GAP;
  const y = (fret) => gridTop + (fret - base + 0.5) * FRET_GAP;

  // The name, centred over the neck.
  const nameX = left + neck / 2 - chordNameWidth(doc, name, 8.5) / 2;
  putChordName(doc, name, nameX, top, { size: 8.5, color: CHORD });

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
    put(doc, `${base}.`, left - 13, y(base) - 3.5, {
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
      // Under the bar there is no dot of its own - except where the
      // fingers are told: there every held string has its numbered dot.
      const underBar = barre && fret === barre.fret && i >= barre.from && i <= barre.to;
      if (!underBar || shape.fingers) doc.circle(x(i), y(fret), DOT).fill(INK);
      const finger = shape.fingers?.[i];
      if (finger) {
        put(doc, finger, x(i) - DOT, y(fret) - FINGER_SIZE * 0.66, {
          font: 'Heading',
          size: FINGER_SIZE,
          color: '#fff',
          width: DOT * 2,
          align: 'center',
        });
      }
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
    // "Mellékletek": a heading among the rows, leading nowhere.
    if (song.heading) {
      put(doc, song.heading, left, y + 1.5, { font: 'Heading', size: 10.5, color: GREEN });
      return;
    }
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

// --- The index: the songs by their artists ---

const ARTIST_INDEX_TITLE = 'Dalok előadók szerint';
// The songs that name no artist, in a group of their own at the end.
const NO_ARTIST = 'Előadó nélkül';
const INDEX_ROW = 14;
// Before an artist's name, apart from the songs above it.
const INDEX_GROUP_GAP = 6;
const INDEX_COLUMN_GAP = 22;

const byHungarian = new Intl.Collator('hu', { sensitivity: 'base' });

// The songs grouped by artist: the artists in the Hungarian alphabet's
// order, each one's songs by title; the songs without an artist last.
// Each song keeps its place in the book (`at`), for its page and link.
export function songsByArtist(songs) {
  const groups = new Map();
  songs.forEach((song, at) => {
    const artist = (song.artist ?? '').trim();
    if (!groups.has(artist)) groups.set(artist, []);
    groups.get(artist).push({ title: song.title, at });
  });
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : byHungarian.compare(a, b)))
    .map(([artist, list]) => ({
      artist: artist || NO_ARTIST,
      songs: list.sort((a, b) => byHungarian.compare(a.title, b.title)),
    }));
}

// From the page the doc stands on: the artists' names, under each its
// songs with their page numbers - every row a link to its song. In two
// columns where the paper is wide enough (A4), going on to new pages as
// needed. songs and pages: the book's, in its order.
function drawArtistIndex(doc, songs, pages) {
  const width = contentRight(doc) - MARGIN;
  const columns = width > 400 ? 2 : 1;
  const columnWidth = (width - INDEX_COLUMN_GAP * (columns - 1)) / columns;
  const bottom = contentBottom(doc);

  put(doc, ARTIST_INDEX_TITLE, MARGIN, MARGIN, { font: 'Heading', size: 18, color: GREEN });
  // Under the title on the first page, from the top on the others.
  let top = MARGIN + 3 * TOC_ROW;
  let column = 0;
  let y = top;

  const nextColumn = () => {
    column += 1;
    if (column >= columns) {
      doc.addPage();
      column = 0;
      top = MARGIN;
    }
    y = top;
  };

  for (const group of songsByArtist(songs)) {
    // The name never stands alone at a column's foot: it needs the room
    // of its first song too.
    const gap = y > top ? INDEX_GROUP_GAP : 0;
    if (y + gap + INDEX_ROW * 2 > bottom) nextColumn();
    else y += gap;
    const left = MARGIN + column * (columnWidth + INDEX_COLUMN_GAP);
    put(doc, fitted(doc, group.artist, 'Heading', 10, columnWidth), left, y, {
      font: 'Heading',
      size: 10,
      color: GREEN,
    });
    y += INDEX_ROW;

    for (const song of group.songs) {
      if (y + INDEX_ROW > bottom) nextColumn();
      const x = MARGIN + column * (columnWidth + INDEX_COLUMN_GAP);
      const right = x + columnWidth;
      const number = String(pages[song.at] + 1);
      const numberWidth = widthOf(doc, number, 'Body', 9.5);
      const title = fitted(doc, song.title, 'Body', 9.5, columnWidth - numberWidth - 20);
      put(doc, title, x + 8, y, { size: 9.5 });
      const end = x + 8 + widthOf(doc, title, 'Body', 9.5);
      // Dots leading to the page number.
      if (right - numberWidth - 6 > end + 6) {
        doc
          .moveTo(end + 5, y + 9)
          .lineTo(right - numberWidth - 5, y + 9)
          .lineWidth(0.6)
          .dash(0.6, { space: 2.6 })
          .strokeColor(LIGHT)
          .stroke()
          .undash();
      }
      put(doc, number, right - numberWidth, y, { size: 9.5 });
      doc.goTo(x, y - 1, columnWidth, INDEX_ROW, `song-${song.at}`);
      y += INDEX_ROW;
    }
  }
}

// A text cut to fit a width, with "…" where it was cut.
function fitted(doc, text, font, size, room) {
  let cut = text;
  while (cut.length > 4 && widthOf(doc, cut, font, size) > room) {
    cut = `${cut.slice(0, -2).trimEnd()}…`;
  }
  return cut;
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
