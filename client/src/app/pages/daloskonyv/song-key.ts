import { NOTATION, Notation, bracketed, keyChord, parseChord } from './chords';

// A song's key (hangnem), worked out from its chords - "C-dúr", "a-moll".
// A key is passed around as its home chord, the songbook's way: "C", "F#",
// "B" for a major key, "am", "f#m" for a minor one; '' where there is none.
//
// It is an estimate: right for most songs, wrong for some (a song that
// starts away from home, or changes key) - so a song can carry a key set
// by hand, which holds until its chords are next changed.

// The chords a key is built of, as [semitones above the home note, minor?,
// how much one of them says for the key]. Home first; the two other main
// chords next; then the rest.
type Degree = [number, boolean, number];

const MAJOR: Degree[] = [
  [0, false, 1.5], // I
  [5, false, 1.2], // IV
  [7, false, 1.2], // V
  [9, true, 1], // vi
  [2, true, 1], // ii
  [4, true, 1], // iii
];

const MINOR: Degree[] = [
  [0, true, 1.5], // i
  [5, true, 1.2], // iv
  // V as a major chord (E in a-moll): what tells a minor key from the
  // major one with the very same notes.
  [7, false, 1.3],
  [7, true, 1], // v
  [3, false, 1], // III
  [8, false, 1], // VI
  [10, false, 1], // VII
];

// A chord that belongs to no chord of the key speaks against it.
const OUTSIDE = -0.8;

interface Heard {
  root: number;
  minor: boolean;
}

// The song's chords as the key hears them: where each stands among the
// twelve notes, and whether it is a minor. Diminished ones say nothing.
function heard(source: string, notation: Notation): Heard[] {
  return bracketed(source).flatMap((name) => {
    const chord = parseChord(name, notation);
    if (!chord || /^(dim|0|°|ø)/.test(chord.rest)) return [];
    return [{ root: chord.root, minor: chord.minor }];
  });
}

// The key the song's chords fit best ('' for a song without chords): every
// chord counts for the keys it belongs to and against the others, and the
// chord the song starts on counts a good deal more - a song mostly starts
// at home. The last one counts a little: it would say as much, but in the
// songbook many songs have their chords written over the first verse
// only, so the last chord written is often not the song's ending.
export function detectKey(source: string, notation: Notation = NOTATION): string {
  const chords = heard(source, notation);
  if (!chords.length) return '';
  const first = chords[0];
  const last = chords[chords.length - 1];
  // Worth a few chords, more in a long song.
  const firstBonus = Math.max(3, chords.length * 0.3);
  const lastBonus = Math.max(1, chords.length * 0.1);
  const isHome = (chord: Heard, root: number, minor: boolean) =>
    chord.root === root && chord.minor === minor;

  let best = { root: 0, minor: false, score: -Infinity };
  // Majors first: of two keys that fit the same, the major one.
  for (const minor of [false, true]) {
    for (let root = 0; root < 12; root += 1) {
      let score = 0;
      for (const chord of chords) {
        const interval = (chord.root - root + 12) % 12;
        const degree = (minor ? MINOR : MAJOR).find(
          ([semitones, isMinor]) => semitones === interval && isMinor === chord.minor,
        );
        score += degree ? degree[2] : OUTSIDE;
      }
      if (isHome(first, root, minor)) score += firstBonus;
      if (isHome(last, root, minor)) score += lastBonus;
      if (score > best.score) best = { root, minor, score };
    }
  }
  return keyChord(best.root, best.minor, notation);
}

// "C" → "C-dúr", "am" → "a-moll", "f#m" → "f#-moll" ('' for what isn't a
// chord).
export function keyName(homeChord: string, notation: Notation = NOTATION): string {
  const chord = parseChord(homeChord, notation);
  if (!chord) return '';
  const home = keyChord(chord.root, chord.minor, notation);
  return chord.minor ? `${home.slice(0, -1)}-moll` : `${home}-dúr`;
}

// A key moved by semitones, spelled the way the new key is written:
// "am" two up is "hm", "E" one down is "Eb".
export function transposeKey(homeChord: string, steps: number, notation: Notation = NOTATION) {
  const chord = parseChord(homeChord, notation);
  if (!chord) return homeChord;
  return keyChord((((chord.root + steps) % 12) + 12) % 12, chord.minor, notation);
}

// The song's key: the one set by hand, or else the one its chords say.
export function songKey(song: { key?: string; chordpro: string }, notation: Notation = NOTATION) {
  return song.key && parseChord(song.key, notation) ? song.key : detectKey(song.chordpro, notation);
}

// The song's chords and nothing else - two texts with the same signature
// have the same chords in the same order (a key set by hand holds while
// this stays the same).
export function chordSignature(source: string): string {
  return bracketed(source).join(' ');
}

// Every key there is to choose from, majors then minors, each in the
// circle of fifths' order.
export function allKeys(notation: Notation = NOTATION): string[] {
  const circle = Array.from({ length: 12 }, (_, i) => (i * 7) % 12);
  return [
    ...circle.map((root) => keyChord(root, false, notation)),
    ...circle.map((root) => keyChord((root + 9) % 12, true, notation)),
  ];
}
