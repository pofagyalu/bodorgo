// The keys and their chords, in the songbook's own notation (H is B, B is
// B♭; minors in lower case) - for the two annexes: the circle of fifths
// (Kvintkör) and the table of each key's chords (Akkordtáblázat). The
// server's PDF draws from the same lists (see its scripts/buildSongText.mjs).

// One key of the circle, clockwise from the top - a fifth up at each step.
export interface CircleKey {
  // The major key; two names where the circle's two halves meet.
  major: string[];
  // Its relative minor.
  minor: string[];
  // How many sharps or flats it is written with ("2 #", "3 b", "0").
  signs: string[];
}

export const CIRCLE: CircleKey[] = [
  { major: ['C'], minor: ['am'], signs: ['0'] },
  { major: ['G'], minor: ['em'], signs: ['1 #'] },
  { major: ['D'], minor: ['hm'], signs: ['2 #'] },
  { major: ['A'], minor: ['f#m'], signs: ['3 #'] },
  { major: ['E'], minor: ['c#m'], signs: ['4 #'] },
  { major: ['H'], minor: ['g#m'], signs: ['5 #'] },
  { major: ['F#', 'Gb'], minor: ['d#m', 'ebm'], signs: ['6 #', '6 b'] },
  { major: ['Db'], minor: ['bm'], signs: ['5 b'] },
  { major: ['Ab'], minor: ['fm'], signs: ['4 b'] },
  { major: ['Eb'], minor: ['cm'], signs: ['3 b'] },
  { major: ['B'], minor: ['gm'], signs: ['2 b'] },
  { major: ['F'], minor: ['dm'], signs: ['1 b'] },
];

// The seven chords built on a major key's notes: which step of the scale,
// how many semitones above the key's own note, and what kind of chord.
export const DEGREES = [
  { roman: 'I', semitones: 0, kind: 'major' },
  { roman: 'ii', semitones: 2, kind: 'minor' },
  { roman: 'iii', semitones: 4, kind: 'minor' },
  { roman: 'IV', semitones: 5, kind: 'major' },
  { roman: 'V', semitones: 7, kind: 'major' },
  { roman: 'vi', semitones: 9, kind: 'minor' },
  { roman: 'vii°', semitones: 11, kind: 'dim' },
] as const;

// The note names a key is written with: its own row of the table, from
// its own note up (the Hungarian way - H, and B for B♭).
const SHARP_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'B', 'H'];
const FLAT_NOTES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'B', 'H'];

// The keys of the table, in the circle's order, each with its place among
// the twelve notes (0 = C) and whether it is written with flats.
const TABLE_KEYS = [
  { root: 0, flats: false },
  { root: 7, flats: false },
  { root: 2, flats: false },
  { root: 9, flats: false },
  { root: 4, flats: false },
  { root: 11, flats: false },
  { root: 6, flats: false },
  { root: 1, flats: true },
  { root: 8, flats: true },
  { root: 3, flats: true },
  { root: 10, flats: true },
  { root: 5, flats: true },
];

export interface KeyChords {
  // The key's name ("G").
  key: string;
  // Its seven chords, in DEGREES' order: G, am, hm, C, D, em, f#°.
  chords: string[];
}

// Every major key with the chords that belong to it - what a song in that
// key is most likely built from (I, IV and V first of all, then vi).
export function keyChords(): KeyChords[] {
  return TABLE_KEYS.map(({ root, flats }) => {
    const notes = flats ? FLAT_NOTES : SHARP_NOTES;
    const chords = DEGREES.map(({ semitones, kind }) => {
      const note = notes[(root + semitones) % 12];
      if (kind === 'major') return note;
      return `${note.toLowerCase()}${kind === 'minor' ? 'm' : '°'}`;
    });
    return { key: notes[root], chords };
  });
}
