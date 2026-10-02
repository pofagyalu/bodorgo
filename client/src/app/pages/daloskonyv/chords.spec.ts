import { firstChord, parseChord, stepsBetween, transposeChordPro, transposer } from './chords';

// A song starting on `key`, moved by `steps`.
const move = (key: string, steps: number, notation: 'international' | 'hungarian') => {
  const t = transposer(key, steps, notation);
  return (...chords: string[]) => chords.map(t).join(' ');
};

describe('parseChord', () => {
  it('reads the root, the minor and the bass', () => {
    expect(parseChord('Am7', 'international')).toEqual({
      root: 9,
      minor: true,
      rest: 'm7',
      bass: null,
      lower: false,
    });
    expect(parseChord('G/B', 'international')).toMatchObject({ root: 7, minor: false, bass: 11 });
    expect(parseChord('Cmaj7', 'international')).toMatchObject({ root: 0, minor: false });
    expect(parseChord('F#m', 'international')).toMatchObject({ root: 6, minor: true });
  });

  it('reads the Hungarian H and B', () => {
    expect(parseChord('H', 'hungarian')?.root).toBe(11);
    expect(parseChord('Hm', 'hungarian')).toMatchObject({ root: 11, minor: true });
    expect(parseChord('B', 'hungarian')?.root).toBe(10);
    expect(parseChord('Bb', 'hungarian')?.root).toBe(10);
    expect(parseChord('G/H', 'hungarian')?.bass).toBe(11);
    expect(parseChord('B', 'international')?.root).toBe(11);
  });

  it('takes a lower-case root for a minor', () => {
    expect(parseChord('am', 'hungarian')).toMatchObject({ root: 9, minor: true, rest: 'm' });
    expect(parseChord('em7', 'hungarian')).toMatchObject({ root: 4, minor: true, rest: 'm7' });
    expect(parseChord('hm', 'hungarian')).toMatchObject({ root: 11, minor: true });
    expect(parseChord('f#m', 'hungarian')).toMatchObject({ root: 6, minor: true, rest: 'm' });
    expect(parseChord('a', 'hungarian')).toMatchObject({ root: 9, minor: true, lower: true });
  });

  it('knows what is not a chord', () => {
    for (const s of ['N.C.', '2x', '', 'Coda', 'Fine', '/']) expect(parseChord(s)).toBeNull();
  });
});

describe('transposer', () => {
  it('leaves the chords as written at 0 (and at a whole octave)', () => {
    expect(move('am', 0, 'hungarian')('am', 'G/H', 'A#')).toBe('am G/H A#');
    expect(move('am', 12, 'hungarian')('am')).toBe('am');
  });

  it('moves every chord by the same steps, keeping the rest', () => {
    expect(move('C', 2, 'international')('C', 'Am7', 'F', 'G7', 'Cmaj7')).toBe('D Bm7 G A7 Dmaj7');
    expect(move('Am', 3, 'international')('Am', 'Dm', 'E7')).toBe('Cm Fm G7');
  });

  it('spells the chords the way the new key is written', () => {
    // E one down is E♭ - flats; E one up is F - flats too (B♭, not A♯).
    expect(move('E', -1, 'international')('E', 'A', 'B7', 'C#m')).toBe('Eb Ab Bb7 Cm');
    expect(move('E', 1, 'international')('E', 'A', 'B7', 'C#m')).toBe('F Bb C7 Dm');
    // G one down is F♯ - sharps.
    expect(move('G', -1, 'international')('G', 'C', 'D', 'Em')).toBe('F# B C# D#m');
    // D minor (one flat) two up is E minor (one sharp).
    expect(move('Dm', 2, 'international')('Dm', 'Bb', 'C', 'A7')).toBe('Em C D B7');
    // A minor two down is G minor - flats.
    expect(move('Am', -2, 'international')('Am', 'F', 'G', 'E')).toBe('Gm Eb F D');
  });

  it('moves the bass note of a slash chord too', () => {
    expect(move('G', 2, 'international')('G/B', 'C/G')).toBe('A/C# D/A');
  });

  it('writes the Hungarian H and B', () => {
    // H is B, B is B♭.
    expect(move('E', 1, 'hungarian')('E', 'A', 'H7')).toBe('F B C7');
    expect(move('G', 2, 'hungarian')('G', 'C', 'D', 'G/H')).toBe('A D E A/C#');
    expect(move('A', 2, 'hungarian')('A', 'D', 'E')).toBe('H E F#');
    expect(move('Hm', -2, 'hungarian')('Hm', 'G', 'A')).toBe('Am F G');
    expect(move('B', 1, 'hungarian')('B', 'Eb', 'F')).toBe('H E F#');
  });

  it('keeps a lower-case minor in lower case', () => {
    expect(move('am', 2, 'hungarian')('am', 'dm', 'E7', 'am7')).toBe('hm em F#7 hm7');
    expect(move('em', -1, 'hungarian')('em', 'am', 'H7', 'f#m')).toBe('d#m g#m A#7 fm');
    expect(move('dm', -2, 'hungarian')('dm', 'gm', 'A7')).toBe('cm fm G7');
  });

  it('gives back what is not a chord name', () => {
    expect(move('C', 2, 'hungarian')('N.C.', '2x', '/')).toBe('N.C. 2x /');
  });
});

describe('transposeChordPro', () => {
  const song = [
    '[am]Adj helyet [D]magad mellett,',
    'Az [dm]ablakhoz én is oda[am]férjek!',
    '',
    '{start_of_chorus}',
    '[C]Engedd, hogy [G/H]érezzem [/] [E7]',
    '{end_of_chorus}',
    '{comment: 2x}',
  ].join('\n');

  it('moves every chord of the song and leaves the rest alone', () => {
    expect(transposeChordPro(song, 2, 'hungarian')).toBe(
      [
        '[hm]Adj helyet [E]magad mellett,',
        'Az [em]ablakhoz én is oda[hm]férjek!',
        '',
        '{start_of_chorus}',
        '[D]Engedd, hogy [A/C#]érezzem [/] [F#7]',
        '{end_of_chorus}',
        '{comment: 2x}',
      ].join('\n'),
    );
  });

  it('spells for the new key, taken from the song’s first chord', () => {
    // A minor two down is G minor: flats (B is the Hungarian B flat).
    expect(transposeChordPro('[am]la [F]la [G]la [E]la', -2, 'hungarian')).toBe(
      '[gm]la [Eb]la [F]la [D]la',
    );
  });

  it('gives the song back as it was at 0, and comes home after twelve', () => {
    expect(transposeChordPro(song, 0, 'hungarian')).toBe(song);
    expect(transposeChordPro(song, 12, 'hungarian')).toBe(song);
    expect(transposeChordPro(transposeChordPro(song, 5, 'hungarian'), -5, 'hungarian')).toBe(song);
  });
});

describe('firstChord and stepsBetween', () => {
  it('finds the song’s first chord', () => {
    expect(firstChord('Szöveg [] [am]Adj [D]helyet')).toBe('am');
    expect(firstChord('csak szöveg')).toBeUndefined();
  });

  it('counts the semitones between two chords’ roots, the short way', () => {
    expect(stepsBetween('hm', 'am', 'hungarian')).toBe(-2);
    expect(stepsBetween('am', 'hm', 'hungarian')).toBe(2);
    expect(stepsBetween('C', 'G', 'hungarian')).toBe(-5);
    expect(stepsBetween('C', 'F#', 'hungarian')).toBe(6);
    expect(stepsBetween('C', 'C', 'hungarian')).toBe(0);
    expect(stepsBetween('C', '2x', 'hungarian')).toBeNull();
  });
});

describe('the note between A and H, the Hungarian way', () => {
  it('is A# in a key written with sharps', () => {
    // E two up is F#: its third chord is A# minor, not "bm".
    expect(move('E', 2, 'hungarian')('E', 'g#m', 'A', 'H')).toBe('F# a#m H C#');
    expect(transposeChordPro('[F#]la [A#]la [H]la', -2, 'hungarian')).toBe('[E]la [G#]la [A]la');
    // There and back: the A# is an A# again.
    const song = '[F#]la [A#m]la [H]la [C#]la';
    expect(transposeChordPro(transposeChordPro(song, 2, 'hungarian'), -2, 'hungarian')).toBe(song);
  });

  it('is B in a key written with flats', () => {
    expect(move('E', 1, 'hungarian')('E', 'A', 'H7')).toBe('F B C7');
    expect(move('am', -2, 'hungarian')('am', 'C', 'dm')).toBe('gm B cm');
  });
});
