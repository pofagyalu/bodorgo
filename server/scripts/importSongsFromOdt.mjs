// Reads the club's old songbook (an .odt: each song a title, an artist and
// the lyrics, with the chords on a line of their own ABOVE the words, set
// in place with tabs and spaces) and turns every song into ChordPro - the
// chords in [brackets] inside the lyrics - for the Daloskönyv.
//
//   node scripts/importSongsFromOdt.mjs "../Dalosfüzet_20231009.odt"
//       only reads: writes songs.json and songs.txt beside the .odt
//       (songs.txt is for reading through), and changes nothing.
//   node scripts/importSongsFromOdt.mjs "<file>.odt" --write
//       also puts the songs into the database DB_URI points at. A song
//       whose title is already there is left alone - so a second run never
//       undoes what was corrected by hand in the editor.
//   ... --write --overwrite
//       replaces the songs already there as well. Careful.
//
// Where a chord lands is an estimate: the .odt places chords by eye, in a
// proportional font. The widths are measured with the real fonts (Windows'
// Fonts folder) where they are found, and each chord is then pulled to the
// start of the nearest syllable. Every song still needs a look in the
// editor (Alt + ← / → moves a chord by a letter).
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import * as fontkit from 'fontkit';

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error('Usage: node scripts/importSongsFromOdt.mjs <file.odt> [--write] [--overwrite]');
  process.exit(1);
}
const WRITE = flags.includes('--write');
const OVERWRITE = flags.includes('--overwrite');

// --- The .odt: a zip with content.xml and styles.xml in it ---

function unzip(buffer, wanted) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const found = {};
  for (let i = 0; i < count; i += 1) {
    const method = buffer.readUInt16LE(at + 10);
    const size = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    if (wanted.includes(name)) {
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const data = buffer.subarray(start, start + size);
      found[name] = (method === 0 ? data : zlib.inflateRawSync(data)).toString('utf8');
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return found;
}

const zip = unzip(fs.readFileSync(file), ['content.xml', 'styles.xml']);
const content = zip['content.xml'];
const stylesXml = zip['styles.xml'];

// --- Styles: each paragraph's font, size, weight and where it starts ---

const toPt = (length) => {
  const m = /^(-?[\d.]+)(cm|mm|in|pt)$/.exec(length ?? '');
  if (!m) return 0;
  return Number(m[1]) * { cm: 28.3465, mm: 2.83465, in: 72, pt: 1 }[m[2]];
};

function readStyles(xml) {
  const styles = {};
  for (const m of xml.matchAll(
    /<style:style style:name="([^"]+)"([^>]*)>([\s\S]*?)<\/style:style>/g,
  )) {
    const [, name, attrs, body] = m;
    if (!/style:family="paragraph"/.test(attrs)) continue;
    styles[name] = {
      parent: /style:parent-style-name="([^"]+)"/.exec(attrs)?.[1] ?? null,
      font: /style:font-name="([^"]+)"/.exec(body)?.[1],
      size: /fo:font-size="([\d.]+)pt"/.exec(body)?.[1],
      bold: /fo:font-weight="(\w+)"/.exec(body)?.[1],
      marginLeft: /fo:margin-left="([^"]+)"/.exec(body)?.[1],
      indent: /fo:text-indent="([^"]+)"/.exec(body)?.[1],
    };
  }
  return styles;
}

const STYLES = { ...readStyles(stylesXml), ...readStyles(content) };
const TAB_PT = toPt(/style:tab-stop-distance="([^"]+)"/.exec(stylesXml)?.[1] ?? '1.249cm');

// A style with everything it inherits filled in.
function resolve(name) {
  const chain = [];
  for (let n = name; n && STYLES[n] && chain.length < 10; n = STYLES[n].parent)
    chain.push(STYLES[n]);
  const pick = (key) => chain.find((s) => s[key] !== undefined)?.[key];
  return {
    font: pick('font') ?? 'Arial',
    size: Number(pick('size') ?? 12),
    bold: pick('bold') === 'bold',
    startPt: toPt(pick('marginLeft')) + toPt(pick('indent')),
  };
}

// The name of the nearest named (not automatic "P12") style.
function namedStyle(name) {
  for (let n = name; n; n = STYLES[n]?.parent) if (!/^P\d+$/.test(n)) return n;
  return name;
}

// --- Fonts: how wide the letters are ---

const FONT_DIR = 'C:/Windows/Fonts';
const FONT_FILES = [
  [/mono|courier/i, 'cour.ttf', 'courbd.ttf'],
  [/times/i, 'times.ttf', 'timesbd.ttf'],
  [/tahoma/i, 'tahoma.ttf', 'tahomabd.ttf'],
  [/calibri/i, 'calibri.ttf', 'calibrib.ttf'],
  [/.*/, 'arial.ttf', 'arialbd.ttf'],
];
const fonts = new Map();

function fontFor(name, bold) {
  const [, regular, heavy] = FONT_FILES.find(([re]) => re.test(name));
  const fileName = bold ? heavy : regular;
  if (!fonts.has(fileName)) {
    try {
      fonts.set(fileName, fontkit.openSync(path.join(FONT_DIR, fileName)));
    } catch {
      fonts.set(fileName, null);
    }
  }
  return fonts.get(fileName);
}

// The left edge of every character of a line (and the line's end), in pt.
function edges(text, style) {
  const font = fontFor(style.font, style.bold);
  const xs = [];
  let x = style.startPt;
  for (const ch of text) {
    xs.push(x);
    if (ch === '\t') {
      x = (Math.floor(x / TAB_PT + 1e-6) + 1) * TAB_PT;
    } else if (font) {
      const glyph = font.glyphForCodePoint(ch.codePointAt(0));
      x += (glyph.advanceWidth / font.unitsPerEm) * style.size;
    } else {
      // No font file: a fair average.
      x += (ch === ' ' ? 0.28 : 0.52) * style.size;
    }
  }
  xs.push(x);
  return xs;
}

// --- The text: one entry per line, with its paragraph's style ---

const unescape = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

function readLines(xml) {
  const body = xml.slice(xml.indexOf('<office:body'));
  const lines = [];
  for (const m of body.matchAll(/<text:(p|h)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/text:\1>)/g)) {
    const styleName = /text:style-name="([^"]+)"/.exec(m[2])?.[1] ?? 'Standard';
    const text = unescape(
      (m[3] ?? '')
        .replace(/<text:tab[^>]*\/>/g, '\t')
        .replace(/<text:s text:c="(\d+)"\/>/g, (all, n) => ' '.repeat(Number(n)))
        .replace(/<text:s\/>/g, ' ')
        .replace(/<text:line-break\/>/g, '\n')
        .replace(/<[^>]+>/g, ''),
    );
    const style = resolve(styleName);
    const named = namedStyle(styleName);
    // A line break inside a paragraph: lines of the same style.
    for (const line of text.split('\n')) lines.push({ text: line, style, named });
  }
  return lines;
}

// --- Chords ---

const CHORD = /^[A-Ha-h][#b]?(?:maj|min|dim|aug|sus|add|m|M|[0-9+\-°()#b])*(?:\/[A-Ha-h][#b]?)?$/;
// What else stands among chords: bar and repeat signs.
const SIGN = /^(?:[/\\|:–\-.,()]+|\|\|:|:\|\||x\d+|\d+x)$/i;
// Words that label a line of chords.
const LABEL = /^(?:intro|szóló|szolo|solo|outro|közjáték|átvezetés|refr?\.?|r\d*[.:]?)[:.]?$/i;

const isChord = (token) => CHORD.test(token.replace(/^[(|:]+|[),|:]+$/g, ''));

// A line holding only chords (with signs and labels among them).
function isChordLine(text) {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length || !tokens.some(isChord)) return false;
  // "A" and "E" alone are also words: a single such token isn't enough
  // on a line that doesn't look like chords otherwise.
  return tokens.every((t) => isChord(t) || SIGN.test(t) || LABEL.test(t));
}

// Whether a chord line's chords were set over the words below (with tabs
// or runs of spaces) - or just typed one after the other ("Em D Am Em"),
// which says the order, not the place.
function isPlaced(text) {
  const inner = text.trim();
  if (!/\s/.test(inner)) return true;
  return inner.includes('\t') || / {2,}/.test(inner);
}

// The chords of a chord line with where each begins (pt).
function chordsOf(line) {
  const xs = edges(line.text, line.style);
  const chords = [];
  for (const m of line.text.matchAll(/\S+/g)) chords.push({ name: m[0], x: xs[m.index] });
  return chords;
}

const VOWEL = /[aáeéiíoóöőuúüű]/i;
const LETTER = /\p{L}/u;
const DIGRAPH = /^(?:cs|dz|gy|ly|ny|sz|ty|zs)$/i;

const isConsonant = (ch) => !!ch && LETTER.test(ch) && !VOWEL.test(ch);

// Where the word around (or after) i starts.
function wordStart(text, i) {
  while (i > 0 && LETTER.test(text[i - 1])) i -= 1;
  return i;
}

function nextWord(text, i) {
  while (i < text.length && !LETTER.test(text[i]) && !/\d/.test(text[i])) i += 1;
  return i;
}

// A chord belongs to a syllable, and a Hungarian syllable starts with the
// one consonant before its vowel ("sz", "gy"… count as one). From the
// letter the chord stands over:
// - a vowel: back to that consonant ("re|g[G]gel" → "reg|[G]gel" is left
//   to the consonant rule below);
// - a consonant: forward to the last consonant before the next vowel
//   ("szabada[am]bban" → "szabadab[am]ban"), or, at a word's end, to the
//   next word;
// - a space or a sign: to the next word.
function toSyllable(text, i) {
  if (i >= text.length) return text.length;
  // In a word with a number in it ("67-es"): at its start.
  if (/\S/.test(text[i])) {
    let from = i;
    while (from > 0 && /\S/.test(text[from - 1])) from -= 1;
    let to = i;
    while (to < text.length && /\S/.test(text[to])) to += 1;
    if (/\d/.test(text.slice(from, to))) return from;
  }
  if (!LETTER.test(text[i])) return nextWord(text, i);
  const start = wordStart(text, i);
  let vowel = i;
  if (isConsonant(text[i])) {
    while (isConsonant(text[vowel])) vowel += 1;
    // No vowel left in the word: the chord is the next word's.
    if (!text[vowel] || !LETTER.test(text[vowel])) return nextWord(text, vowel);
  }
  // The syllable of the vowel at `vowel`: from the consonant before it.
  if (vowel - 1 < start || !isConsonant(text[vowel - 1])) return vowel;
  if (vowel - 2 >= start && DIGRAPH.test(text.slice(vowel - 2, vowel))) return vowel - 2;
  return vowel - 1;
}

// The chords of the line above written into the words.
function merge(chordLine, lyricLine) {
  const text = lyricLine.text;
  const xs = edges(text, lyricLine.style);
  const end = xs[xs.length - 1];
  const inserts = chordsOf(chordLine).map((chord) => {
    // Past the words: after them.
    if (chord.x > end + lyricLine.style.size * 0.3) return { at: text.length, chord };
    let nearest = 0;
    for (let i = 1; i < text.length; i += 1) {
      if (Math.abs(xs[i] - chord.x) < Math.abs(xs[nearest] - chord.x)) nearest = i;
    }
    // A sign ("/", "|") stands before a word, never inside one.
    if (!isChord(chord.name)) return { at: wordStart(text, nearest), chord };
    return { at: toSyllable(text, nearest), chord };
  });
  let out = '';
  let from = 0;
  for (const { at, chord } of inserts) {
    const cut = Math.max(at, from);
    out += text.slice(from, cut);
    // After the last word: apart from it, and from each other.
    if (cut >= text.length && out && !/\s$/.test(out)) out += ' ';
    out += `[${chord.name}]`;
    from = cut;
  }
  return out + text.slice(from);
}

// A line of chords with no words under it: "[G] [D] [em]", labels as text.
const chordsOnly = (text) =>
  text
    .trim()
    .split(/\s+/)
    .map((t) => (LABEL.test(t) ? t : `[${t}]`))
    .join(' ');

const tidy = (line) => line.replace(/\t/g, ' ').replace(/ {2,}/g, ' ').trim();

// --- Songs ---

// A title or an artist: a bold line of the plain style, or the artist's
// own style - never a line of chords.
function isHeading(line) {
  if (!/[\p{L}\p{N}]/u.test(line.text) || isChordLine(line.text)) return false;
  if (line.named === 'Dal_20_szerzője' || line.named === 'Heading_20_1') return true;
  return line.named === 'Standard' && line.style.bold;
}

const sameTitle = (a, b) => {
  const fold = (s) =>
    s
      .normalize('NFD')
      .replace(/[^\p{L}\p{N}]/gu, '')
      .toLowerCase();
  return fold(a).startsWith(fold(b).slice(0, 8)) || fold(b).startsWith(fold(a).slice(0, 8));
};

function readSongs(lines) {
  const songs = [];
  let i = 0;
  while (i < lines.length) {
    if (!isHeading(lines[i])) {
      i += 1;
      continue;
    }
    // The headings before the song: empty lines between them don't part them.
    const heads = [];
    while (i < lines.length && (isHeading(lines[i]) || !lines[i].text.trim())) {
      if (lines[i].text.trim()) heads.push(tidy(lines[i].text));
      i += 1;
    }
    // The song's lines: up to the next heading.
    const body = [];
    while (i < lines.length && !isHeading(lines[i])) {
      body.push(lines[i]);
      i += 1;
    }
    // [title, artist]; or the title twice (the contents' and the song's
    // own) and the artist; or a section's name before them ("Gyerekdalok").
    let title;
    let artist = '';
    if (heads.length >= 3) {
      const own = sameTitle(heads[0], heads[1]) ? 0 : 1;
      title = heads[own];
      artist = heads[heads.length - 1];
    } else {
      [title, artist = ''] = heads;
    }
    songs.push({ title, artist, chordpro: toChordPro(body) });
  }
  return songs;
}

function toChordPro(body) {
  const out = [];
  for (let i = 0; i < body.length; i += 1) {
    const line = body[i];
    if (!line.text.trim()) {
      out.push('');
    } else if (isChordLine(line.text)) {
      const next = body[i + 1];
      if (isPlaced(line.text) && next && next.text.trim() && !isChordLine(next.text)) {
        out.push(tidy(merge(line, next)));
        i += 1;
      } else {
        out.push(chordsOnly(line.text));
      }
    } else {
      out.push(tidy(line.text));
    }
  }
  // One empty line between verses, none at the ends.
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

let songs = readSongs(readLines(content));
// The book's appendix (the chord table) and its cover note aren't songs.
const appendix = songs.findIndex((s) => /^Melléklet/i.test(s.title));
if (appendix >= 0) songs = songs.slice(0, appendix);
songs = songs.filter((s) => s.title && s.chordpro);

const outDir = path.dirname(path.resolve(file));
fs.writeFileSync(path.join(outDir, 'songs.json'), JSON.stringify(songs, null, 2));
fs.writeFileSync(
  path.join(outDir, 'songs.txt'),
  songs
    .map(
      (s) => `${'='.repeat(60)}\n${s.title}${s.artist ? ` — ${s.artist}` : ''}\n\n${s.chordpro}\n`,
    )
    .join('\n'),
);
const withChords = songs.filter((s) => s.chordpro.includes('[')).length;
console.log(`${songs.length} songs read (${withChords} with chords) → songs.json, songs.txt`);
const missing = [...fonts].filter(([, font]) => !font).map(([name]) => name);
if (missing.length) console.log(`Fonts not found (average widths used): ${missing.join(', ')}`);

if (WRITE) {
  const { default: mongoose } = await import('mongoose');
  const { default: Song } = await import('../src/models/songModel.js');
  await mongoose.connect(process.env.DB_URI);
  console.log(`Database: ${mongoose.connection.name}`);
  let added = 0;
  let replaced = 0;
  let kept = 0;
  for (const song of songs) {
    const existing = await Song.findOne({ title: song.title });
    if (existing && !OVERWRITE) {
      kept += 1;
    } else if (existing) {
      existing.set({ artist: song.artist, chordpro: song.chordpro });
      await existing.save();
      replaced += 1;
    } else {
      await Song.create({ ...song, slug: await Song.freeSlug(song.title) });
      added += 1;
    }
  }
  console.log(`added ${added}, replaced ${replaced}, left alone ${kept}`);
  await mongoose.disconnect();
}
