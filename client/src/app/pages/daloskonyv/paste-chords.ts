// A song copied from a web page of tabs, where each line of chords stands
// over the line of words it belongs to:
//
//   Am        F
//   Lent a völgyben ég a tűz
//
// turned into the editor's ChordPro, the chords written into the words at
// the letter they stood over: "[am]Lent a völgy[F]ben ég a tűz". The
// editor does this to what is pasted into it (song-edit.ts).

// A chord's name - the international way ("Am", "Bb", "F#m7/C#") or the
// songbook's own ("am", "H").
const CHORD =
  /^([A-Ha-h])([#b]?)((?:maj|min|dim|aug|sus|add|m|M|[0-9+\-°ø()#b])*)(?:\/([A-Ha-h])([#b]?))?$/;
// What else stands among chords: bar and repeat signs, "N.C.".
const SIGN = /^(?:[/\\|:–\-.,()*]+|\|\|:|:\|\||\(?x\d+\)?|\(?\d+x\)?|N\.?C\.?)$/i;
// A label on a line of its own: "[Verse 1]", "[Chorus]".
const LABEL_LINE = /^\s*\[[^\]]*\]\s*$/;
// A line of tablature: "e|---3---0---|".
const STAVE = /^\s*[A-Ha-h]?[#b]?\s*\|?[-\d|hpbrsx/\\~()^. ]*-{3,}[-\d|hpbrsx/\\~()^. ]*$/;

const bare = (token: string) => token.replace(/^[(|:]+|[),|:]+$/g, '');
const isChord = (token: string) => CHORD.test(bare(token));

// A line holding only chords (with signs among them).
function isChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (!tokens.some(isChord)) return false;
  return tokens.every((t) => isChord(t) || SIGN.test(t));
}

// Whether the chords are written the songbook's way already: an H, or a
// minor in lower case ("am") - then B is the Hungarian B and nothing is
// renamed.
function isHungarian(lines: string[]): boolean {
  return lines
    .filter(isChordLine)
    .some((line) =>
      line.split(/\s+/).some((t) => isChord(t) && /^[Hh]|^[a-h]|\/[Hh]/.test(bare(t))),
    );
}

// An international chord name the songbook's way: B is H, B♭ is B, and a
// minor has its root in lower case - "Bm" → "hm", "Bb" → "B", "Am7/G" →
// "am7/G". What isn't a chord comes back as it was.
export function toSongbookChord(name: string): string {
  const m = CHORD.exec(name);
  if (!m) return name;
  const note = (letter: string, accidental: string) => {
    if (letter.toUpperCase() !== 'B') return letter + accidental;
    return accidental === 'b' ? 'B' : `H${accidental}`;
  };
  const [, letter, accidental, rest, bassLetter, bassAccidental] = m;
  const minor = rest.startsWith('m') && !rest.startsWith('maj');
  const root = note(letter, accidental);
  const bass = bassLetter ? `/${note(bassLetter, bassAccidental)}` : '';
  return (minor ? root.toLowerCase() : root) + rest + bass;
}

const VOWEL = /[aáeéiíoóöőuúüű]/i;
// Two letters, one consonant.
const DIGRAPH = /^(?:cs|dz|gy|ly|ny|sz|ty|zs)$/i;
const LETTER = /\p{L}/u;

const isConsonant = (ch: string | undefined) => !!ch && LETTER.test(ch) && !VOWEL.test(ch);

function nextWord(text: string, i: number): number {
  while (i < text.length && !LETTER.test(text[i]) && !/\d/.test(text[i])) i += 1;
  return i;
}

// A chord belongs to a syllable. From the letter it stood over: on a
// space or a sign, the next word; on a vowel, back to the one consonant
// before it ("gy", "sz"… count as one); on a consonant, forward to the
// last consonant before the next vowel (at a word's end: the next word).
function toSyllable(text: string, i: number): number {
  if (i >= text.length) return text.length;
  if (!LETTER.test(text[i])) return nextWord(text, i);
  let start = i;
  while (start > 0 && LETTER.test(text[start - 1])) start -= 1;
  let vowel = i;
  if (isConsonant(text[i])) {
    while (isConsonant(text[vowel])) vowel += 1;
    if (!text[vowel] || !LETTER.test(text[vowel])) return nextWord(text, vowel);
  }
  if (vowel - 1 < start || !isConsonant(text[vowel - 1])) return vowel;
  if (vowel - 2 >= start && DIGRAPH.test(text.slice(vowel - 2, vowel))) return vowel - 2;
  return vowel - 1;
}

// The chords of the line above written into the words, each at the column
// it stood at.
function merge(chordLine: string, words: string, name: (chord: string) => string): string {
  let out = '';
  let from = 0;
  for (const m of chordLine.matchAll(/\S+/g)) {
    const at = isChord(m[0]) ? toSyllable(words, m.index) : nextWord(words, m.index);
    const cut = Math.max(Math.min(at, words.length), from);
    out += words.slice(from, cut);
    // Past the words: apart from them, and from each other.
    if (cut >= words.length && out.trim() && !/\s$/.test(out)) out += ' ';
    out += `[${isChord(m[0]) ? name(bare(m[0])) : m[0]}]`;
    from = cut;
  }
  return out + words.slice(from);
}

// A tab is as wide as the way to the next eighth column.
const untab = (line: string) =>
  line.replace(/\t/g, (_tab, at: number) => ' '.repeat(8 - (at % 8))).replace(/ /g, ' ');

const tidy = (line: string) => line.replace(/ {2,}/g, ' ').trim();

// The pasted text as ChordPro - or null where it isn't chords over words:
// plain text, or ChordPro already (it is pasted as it is then).
export function chordsOverLyrics(pasted: string): string | null {
  const lines = pasted
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(untab)
    .filter((line) => !STAVE.test(line) || isChordLine(line));

  // One "A" or "E" alone may be a word: two lines of chords, or one line
  // with two chords, are needed.
  const chordLines = lines.filter(isChordLine);
  const chords = chordLines.flatMap((line) => line.split(/\s+/).filter(isChord));
  if (chords.length < 2) return null;
  // Chords among the words already: ChordPro.
  const inWords = lines.some(
    (line) =>
      !LABEL_LINE.test(line) && [...line.matchAll(/\[([^\]]+)\]/g)].some((m) => isChord(m[1])),
  );
  if (inWords) return null;

  const name = isHungarian(lines) ? (chord: string) => chord : toSongbookChord;
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!isChordLine(line)) {
      out.push(tidy(line));
      continue;
    }
    const below = lines[i + 1];
    const hasWords =
      below !== undefined && below.trim() && !isChordLine(below) && !LABEL_LINE.test(below);
    if (hasWords) {
      out.push(tidy(merge(line, below, name)));
      i += 1;
    } else {
      // No words under it (an intro): the chords one after the other.
      out.push(tidy(merge(line, '', name)));
    }
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
