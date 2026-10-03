// Chord names: reading them and moving them up or down by semitones
// (transposing - only on the screen, the song itself is never changed).

// Hungarian songbooks write H for B and B for B♭ ("H, Hm, B"); the
// international way is "B, Bm, Bb".
export type Notation = 'international' | 'hungarian';

// How the club's songbook is written (it also writes minors in lower
// case: "am", "em", "hm" - read here as Am, Em, Hm).
export const NOTATION: Notation = 'hungarian';

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NATURAL: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, H: 11 };

// Root, the rest ("m7", "sus4"...), and a bass note after a slash (G/H).
const CHORD = /^([A-Ha-h])([#b]?)([^/]*)(?:\/([A-Ha-h])([#b]?))?$/;
// What may follow a root - so a word ("Coda") is never taken for a chord.
const REST = /^(?:maj|min|dim|aug|sus|add|m|M|[0-9+\-°ø()#b,])*$/;

export interface Chord {
  // 0 (C) … 11 (B, the Hungarian H).
  root: number;
  minor: boolean;
  // After the root, as written: "m7", "sus4", "" …
  rest: string;
  bass: number | null;
  // Written the songbook's way, with a lower-case root ("am", "hm7").
  lower: boolean;
}

function pitch(letter: string, accidental: string, notation: Notation): number {
  const note = letter.toUpperCase();
  if (note === 'B' && !accidental && notation === 'hungarian') return 10;
  const shift = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  return (NATURAL[note] + shift + 12) % 12;
}

// null for anything that isn't a chord name ("N.C.", "2x").
export function parseChord(name: string, notation: Notation = NOTATION): Chord | null {
  const m = CHORD.exec(name.trim());
  if (!m || !REST.test(m[3])) return null;
  const rest = m[3];
  // A lower-case root is a minor: "am" and "a" are both A minor.
  const lower = m[1] !== m[1].toUpperCase();
  return {
    root: pitch(m[1], m[2], notation),
    minor: lower || (rest.startsWith('m') && !rest.startsWith('maj')),
    rest,
    bass: m[4] ? pitch(m[4], m[5], notation) : null,
    lower,
  };
}

// A piece of a chord's name as it is written out: plain letters, or a
// number set as an index - raised and smaller ("F7" → F⁷, "Gsus2" → Gsus²).
export interface ChordNamePiece {
  text: string;
  index: boolean;
}

// A chord's name cut up for writing: every number in it is an index
// (G7sus4 → G⁷sus⁴, am7 → am⁷, Cadd9 → Cadd⁹), the bass after the slash is
// plain (D7/F# → D⁷/F#). What isn't a chord ("2x", "Intro 2") stays whole.
export function chordNamePieces(name: string, notation: Notation = NOTATION): ChordNamePiece[] {
  if (!parseChord(name, notation)) return [{ text: name, index: false }];
  const slash = name.indexOf('/');
  const main = slash < 0 ? name : name.slice(0, slash);
  const pieces = main
    .split(/(\d+)/)
    .filter(Boolean)
    .map((text) => ({ text, index: /^\d+$/.test(text) }));
  if (slash >= 0) pieces.push({ text: name.slice(slash), index: false });
  return pieces;
}

function noteName(pc: number, flats: boolean, notation: Notation): string {
  if (notation === 'hungarian') {
    if (pc === 11) return 'H';
    // The note between A and H: "B" where the key is written with flats
    // (the Hungarian name of B♭), "A#" where it is written with sharps.
    if (pc === 10 && flats) return 'B';
  }
  return (flats ? FLATS : SHARPS)[pc];
}

// Whether a key is written with flats: F, B♭, E♭, A♭, D♭ major and their
// relative minors (Dm, Gm, Cm, Fm, B♭m) - every other key with sharps.
const FLAT_KEYS = new Set([5, 10, 3, 8, 1]);
function keyUsesFlats(root: number, minor: boolean): boolean {
  return FLAT_KEYS.has(minor ? (root + 3) % 12 : root);
}

// A song's transposer: every chord moved by the same number of semitones,
// and all of them spelled the way the new key is written - a song in E
// one down is in E♭ (E♭, A♭, B♭), not in D♯. The key is taken from the
// song's first chord. A minor written in lower case stays in lower case
// ("am" two up is "hm"). At 0 the chords stay exactly as they were
// written; what isn't a chord name comes back untouched.
export function transposer(
  firstChord: string | undefined,
  steps: number,
  notation: Notation = NOTATION,
): (chord: string) => string {
  const by = ((steps % 12) + 12) % 12;
  if (!by) return (chord) => chord;
  const key = firstChord ? parseChord(firstChord, notation) : null;
  const flats = key ? keyUsesFlats((key.root + by) % 12, key.minor) : false;
  return (name) => {
    const chord = parseChord(name, notation);
    if (!chord) return name;
    const note = (pc: number) => noteName((pc + by) % 12, flats, notation);
    const root = chord.lower ? note(chord.root).toLowerCase() : note(chord.root);
    return root + chord.rest + (chord.bass === null ? '' : `/${note(chord.bass)}`);
  };
}

// A whole song's ChordPro text with every chord moved - for keeping a song
// in the key it was tried in on the screen. The very same chords the song
// page shows at that transposition (the key from the first chord, as
// there); the words and everything else stay as they are.
export function transposeChordPro(
  source: string,
  steps: number,
  notation: Notation = NOTATION,
): string {
  const move = transposer(firstChord(source), steps, notation);
  return source.replace(BRACKETS, (_, name: string) => `[${move(name.trim())}]`);
}

const BRACKETS = /\[([^\]\n]*)\]/g;

// The first chord of a song's ChordPro text - what its key is taken from.
export function firstChord(source: string): string | undefined {
  return [...source.matchAll(BRACKETS)].map((m) => m[1].trim()).find(Boolean);
}

// How many semitones from one chord's root to another's, the short way
// round (-5…+6) - null if either isn't a chord. From a song's first chord
// to the one it was first written with: how to see it in its old key.
export function stepsBetween(from: string, to: string, notation: Notation = NOTATION) {
  const [a, b] = [parseChord(from, notation), parseChord(to, notation)];
  if (!a || !b) return null;
  const up = (b.root - a.root + 12) % 12;
  return up > 6 ? up - 12 : up;
}
