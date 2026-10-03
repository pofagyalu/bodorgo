import { Notation, NOTATION, parseChord } from './chords';

// How a chord is held: on the guitar (6 strings, E A D G H e) or on the
// ukulele (4 strings, G C E A) - for the diagrams.

export type Instrument = 'guitar' | 'ukulele';

export interface ChordShape {
  // A fret per string, from the lowest-sounding side of the neck's picture
  // (left) to the right: 0 open, -1 not played.
  frets: number[];
  // One finger laid across several strings.
  barre: { fret: number; from: number; to: number } | null;
}

// The kinds of chord there are shapes for; anything else falls back to
// the nearest plainer one (see quality()).
type Quality =
  'maj' | 'm' | '7' | 'm7' | 'maj7' | 'sus4' | 'sus2' | '6' | '9' | 'add9' | 'dim' | 'aug';

// A way of holding one chord: its root (0 = C … 11 = H) and the frets
// ("x" = not played). A movable one can be slid up the neck for the other
// roots - its open strings become a barre.
interface Template {
  root: number;
  frets: string;
  movable?: boolean;
  // A shape that is the same chord again every so many frets (the
  // ukulele's dim and aug).
  period?: number;
}

const open = (root: number, frets: string): Template => ({ root, frets });
const movable = (root: number, frets: string, period?: number): Template => ({
  root,
  frets,
  movable: true,
  period,
});

const [C, D, E, F, G, A, H] = [0, 2, 4, 5, 7, 9, 11];

// Guitar: the well-known open chords as they are, and for every other root
// the two barre families - the E shapes (root on the lowest string) and
// the A shapes (root on the A string).
const GUITAR: Record<Quality, Template[]> = {
  maj: [
    open(C, 'x32010'),
    open(D, 'xx0232'),
    open(G, '320003'),
    movable(E, '022100'),
    movable(A, 'x02220'),
  ],
  m: [open(D, 'xx0231'), movable(E, '022000'), movable(A, 'x02210')],
  '7': [
    open(C, 'x32310'),
    open(D, 'xx0212'),
    open(G, '320001'),
    open(H, 'x21202'),
    movable(E, '020100'),
    movable(A, 'x02020'),
  ],
  m7: [open(D, 'xx0211'), movable(E, '020000'), movable(A, 'x02010')],
  maj7: [
    open(C, 'x32000'),
    open(D, 'xx0222'),
    open(F, 'xx3210'),
    open(G, '320002'),
    movable(E, '021100'),
    movable(A, 'x02120'),
  ],
  sus4: [
    open(C, 'x33011'),
    open(D, 'xx0233'),
    open(G, '330013'),
    movable(E, '022200'),
    movable(A, 'x02230'),
  ],
  sus2: [
    open(C, 'x30033'),
    open(D, 'xx0230'),
    open(E, '024400'),
    open(F, 'xx3011'),
    open(G, '300033'),
    movable(A, 'x02200'),
  ],
  '6': [
    open(C, 'x32210'),
    open(D, 'xx0202'),
    open(G, '320000'),
    movable(E, '022120'),
    movable(A, 'x02222'),
  ],
  '9': [
    open(D, 'xx0210'),
    movable(E, '020102'),
    // The C9 shape: no open strings, so it slides anywhere as it is.
    movable(C, 'x3233x'),
    movable(A, 'x02423'),
  ],
  add9: [open(C, 'x32030'), open(G, '320203'), open(D, 'xx0230'), movable(A, 'x02420')],
  dim: [movable(A, 'x0121x'), movable(D, 'xx0101')],
  aug: [movable(E, '032110'), movable(A, 'x03221')],
};

// Ukulele: every open shape can be slid up, so each kind has a few to
// choose the lowest from.
const UKULELE: Record<Quality, Template[]> = {
  maj: [
    movable(C, '0003'),
    movable(D, '2220'),
    movable(F, '2010'),
    movable(G, '0232'),
    movable(A, '2100'),
  ],
  m: [
    movable(C, '0333'),
    movable(D, '2210'),
    movable(E, '0432'),
    movable(F, '1013'),
    movable(6, '2120'),
    movable(G, '0231'),
    movable(A, '2000'),
  ],
  '7': [
    movable(C, '0001'),
    movable(D, '2223'),
    movable(E, '1202'),
    movable(F, '2313'),
    movable(G, '0212'),
    movable(A, '0100'),
  ],
  m7: [movable(D, '2213'), movable(E, '0202'), movable(G, '0211'), movable(A, '0000')],
  maj7: [
    movable(C, '0002'),
    movable(D, '2224'),
    movable(F, '2413'),
    movable(G, '0222'),
    movable(A, '1100'),
  ],
  sus4: [
    movable(C, '0013'),
    movable(D, '0230'),
    movable(F, '3011'),
    movable(G, '0233'),
    movable(A, '2200'),
  ],
  sus2: [movable(C, '0233'), movable(D, '2200'), movable(F, '0013'), movable(G, '0230')],
  '6': [movable(C, '0000'), movable(D, '2222'), movable(F, '2213'), movable(G, '0202')],
  '9': [movable(C, '0201'), movable(D, '2424'), movable(G, '2212'), movable(A, '0102')],
  add9: [movable(C, '0203'), movable(F, '0010'), movable(G, '0252')],
  // The ukulele's "dim" is the four-note one: the same shape every 3 frets.
  dim: [movable(1, '0101', 3)],
  // The same shape every 4 frets.
  aug: [movable(3, '0332', 4), movable(C, '1003', 4)],
};

const SHAPES: Record<Instrument, Record<Quality, Template[]>> = {
  guitar: GUITAR,
  ukulele: UKULELE,
};

// What kind of chord the letters after the root mean - the songbook's own
// ways included ("C-" and a lower-case root are minors, "D4" is Dsus4,
// "C#0" is diminished, "Fmaj" is Fmaj7). What has no shape of its own goes
// to the plainer chord it is built on (m9 → m7, 13 → 7, m6 → m).
function quality(rest: string, minor: boolean): Quality {
  let r = rest.replace(/[()]/g, '');
  if (minor && !r.startsWith('m')) r = `m${r}`;
  if (r === '-') return 'm';
  if (/^(dim7?|0|°|m7b5|ø)/.test(r)) return 'dim';
  if (/^(aug|\+)/.test(r)) return 'aug';
  if (/^(maj|M)/.test(r)) return 'maj7';
  if (/^m(in)?/.test(r)) return /^m(in)?(7|9|11)/.test(r) ? 'm7' : 'm';
  if (/^(sus4|sus$|4)/.test(r)) return 'sus4';
  if (/^(sus2|2)/.test(r)) return 'sus2';
  if (/^add9/.test(r)) return 'add9';
  if (/^9/.test(r)) return '9';
  if (/^6/.test(r)) return '6';
  if (/^(7|11|13)/.test(r)) return '7';
  return 'maj';
}

const fretsOf = (t: Template) => [...t.frets].map((f) => (f === 'x' ? -1 : Number(f)));

// The guitar's three low strings (E, A, D), as places among the twelve
// notes - where a slash chord's bass note goes.
const BASS_STRINGS = [4, 9, 2];

// A slash chord on the guitar ("am/C", "G/H"): the same chord with the
// note after the slash as its lowest - on the lowest of the three bass
// strings where that note is within the hand's reach of the shape; the
// strings under it aren't played. The shape as it was when the note is
// its lowest already, or is nowhere in reach.
function withBass(shape: ChordShape, bass: number): ChordShape {
  const lowest = shape.frets.findIndex((f) => f >= 0);
  if (lowest < 0 || lowest > 2) return shape;
  if ((BASS_STRINGS[lowest] + shape.frets[lowest]) % 12 === bass) return shape;

  for (let string = 0; string < BASS_STRINGS.length; string += 1) {
    const fret = (bass - BASS_STRINGS[string] + 12) % 12;
    const frets = shape.frets.map((f, i) => (i < string ? -1 : i === string ? fret : f));
    const held = frets.filter((f) => f > 0);
    // Four frets is what a hand spans.
    if (held.length && Math.max(...held) - Math.min(...held) > 3) continue;
    // The finger laid across reaches only the strings still at its fret.
    let barre = shape.barre;
    if (barre) {
      const fretOf = barre.fret;
      const at = frets.flatMap((f, i) => (i > string && f === fretOf ? [i] : []));
      barre =
        at.length > 1 && frets.slice(at[0]).every((f) => f >= fretOf)
          ? { fret: fretOf, from: at[0], to: at[at.length - 1] }
          : null;
    }
    return { frets, barre };
  }
  return shape;
}

// The lowest way of holding a chord on the instrument - null for what
// isn't a chord name. A slash chord ("G/H") is the chord with that note
// as its lowest on the guitar; on the ukulele (four strings, the lowest
// in the middle) just the chord.
export function chordShape(
  name: string,
  instrument: Instrument,
  notation: Notation = NOTATION,
): ChordShape | null {
  const chord = parseChord(name, notation);
  if (!chord) return null;
  const templates = SHAPES[instrument][quality(chord.rest, chord.minor)];

  let best: ChordShape | null = null;
  let bestTop = Infinity;
  let bestUp = Infinity;
  for (const template of templates) {
    const up = ((chord.root - template.root + 12) % 12) % (template.period ?? 12);
    if (up && !template.movable) continue;
    const base = fretsOf(template);
    const frets = base.map((f) => (f < 0 ? f : f + up));
    const top = Math.max(...frets);
    // The lowest on the neck; of two as low, the one slid up less.
    if (top > bestTop || (top === bestTop && up >= bestUp)) continue;
    // Slid up, the strings that were open are held down by one finger.
    const held = base.flatMap((f, i) => (f === 0 ? [i] : []));
    bestTop = top;
    bestUp = up;
    best = {
      frets,
      barre: up && held.length > 1 ? { fret: up, from: held[0], to: held[held.length - 1] } : null,
    };
  }
  if (best && chord.bass !== null && instrument === 'guitar') return withBass(best, chord.bass);
  return best;
}

// The song's chords, each once, in the order they first come.
export function uniqueChords(chords: string[], notation: Notation = NOTATION): string[] {
  const seen = new Set<string>();
  return chords.filter((name) => {
    if (seen.has(name) || !parseChord(name, notation)) return false;
    seen.add(name);
    return true;
  });
}
