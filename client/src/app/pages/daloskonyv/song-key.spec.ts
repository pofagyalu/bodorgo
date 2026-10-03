import { transposeChordPro } from './chords';
import { allKeys, chordSignature, detectKey, keyName, songKey, transposeKey } from './song-key';

// A song as its chords, in order.
const song = (...chords: string[]) => chords.map((c) => `[${c}]la`).join(' ');
const key = (...chords: string[]) => detectKey(song(...chords), 'hungarian');

describe('detectKey', () => {
  it('finds a major key from its three main chords', () => {
    expect(key('C', 'F', 'G', 'C')).toBe('C');
    expect(key('G', 'D', 'em', 'C', 'G', 'D', 'G')).toBe('G');
    expect(key('D', 'G', 'A7', 'D')).toBe('D');
    expect(key('A', 'D', 'E', 'A')).toBe('A');
    expect(key('E', 'A', 'H7', 'E')).toBe('E');
  });

  it('finds a minor key - the major chord on its fifth gives it away', () => {
    expect(key('am', 'dm', 'E', 'am')).toBe('am');
    expect(key('em', 'am', 'H7', 'em')).toBe('em');
    expect(key('dm', 'gm', 'A7', 'dm')).toBe('dm');
    expect(key('hm', 'em', 'F#', 'hm')).toBe('hm');
  });

  it('tells a major key from its relative minor by where the song starts and ends', () => {
    // The very same four chords.
    expect(key('C', 'am', 'F', 'G', 'C')).toBe('C');
    expect(key('am', 'F', 'C', 'G', 'am')).toBe('am');
    expect(key('em', 'C', 'G', 'D', 'em')).toBe('em');
  });

  it('is not misled by a song that starts away from home', () => {
    expect(key('F', 'G', 'C', 'am', 'F', 'G', 'C')).toBe('C');
    expect(key('D', 'G', 'D', 'G', 'C', 'G')).toBe('G');
  });

  it('writes flat keys with flats, the Hungarian B for B flat', () => {
    expect(key('F', 'B', 'C', 'F')).toBe('F');
    expect(key('B', 'Eb', 'F', 'B')).toBe('B');
    expect(key('gm', 'cm', 'D7', 'gm')).toBe('gm');
  });

  it('reads the chords whatever stands with them', () => {
    expect(
      detectKey('[Intro] [C]Tavaszi [F]szél [G7]vizet [C]áraszt [2x]\n{comment: x}', 'hungarian'),
    ).toBe('C');
    expect(key('C/G', 'Fmaj7', 'G7sus4', 'C')).toBe('C');
  });

  it('has nothing for a song without chords', () => {
    expect(detectKey('csak szöveg', 'hungarian')).toBe('');
    expect(detectKey('[Intro] [2x]', 'hungarian')).toBe('');
  });
});

describe('keyName', () => {
  it('names the key the Hungarian way', () => {
    expect(keyName('C')).toBe('C-dúr');
    expect(keyName('am')).toBe('a-moll');
    expect(keyName('H')).toBe('H-dúr');
    expect(keyName('hm')).toBe('h-moll');
    expect(keyName('F#')).toBe('F#-dúr');
    expect(keyName('f#m')).toBe('f#-moll');
    expect(keyName('B')).toBe('B-dúr');
    expect(keyName('Eb')).toBe('Eb-dúr');
    expect(keyName('')).toBe('');
    expect(keyName('Intro')).toBe('');
  });

  it('reads a key however its chord was written', () => {
    expect(keyName('Am')).toBe('a-moll');
    expect(keyName('A#')).toBe('B-dúr');
  });
});

describe('transposeKey', () => {
  it('moves a key and spells it the way it is written', () => {
    expect(transposeKey('am', 2)).toBe('hm');
    expect(transposeKey('C', 2)).toBe('D');
    expect(transposeKey('E', -1)).toBe('Eb');
    expect(transposeKey('G', -1)).toBe('F#');
    expect(transposeKey('am', -2)).toBe('gm');
    expect(transposeKey('C', 12)).toBe('C');
  });
});

describe('songKey', () => {
  it('is the key set by hand, or else the one the chords say', () => {
    expect(songKey({ key: 'am', chordpro: song('C', 'F', 'G', 'C') })).toBe('am');
    expect(songKey({ key: '', chordpro: song('C', 'F', 'G', 'C') })).toBe('C');
    expect(songKey({ chordpro: song('C', 'F', 'G', 'C') })).toBe('C');
    expect(songKey({ key: 'nem akkord', chordpro: song('C', 'F', 'G', 'C') })).toBe('C');
  });
});

describe('chordSignature', () => {
  it('is the same while only the words change', () => {
    expect(chordSignature('[C]Tavaszi [G]szél')).toBe(chordSignature('[C]Őszi  [G]eső\n'));
    expect(chordSignature('[C]Tavaszi [G]szél')).not.toBe(chordSignature('[C]Tavaszi [G7]szél'));
  });
});

describe('allKeys', () => {
  it('lists the twelve major and the twelve minor keys', () => {
    expect(allKeys('hungarian')).toEqual([
      'C',
      'G',
      'D',
      'A',
      'E',
      'H',
      'F#',
      'Db',
      'Ab',
      'Eb',
      'B',
      'F',
      'am',
      'em',
      'hm',
      'f#m',
      'c#m',
      'g#m',
      'd#m',
      'bm',
      'fm',
      'cm',
      'gm',
      'dm',
    ]);
  });
});

describe('transposing by the song’s key', () => {
  it('spells for the key, not for the first chord', () => {
    // In C, starting on F: two down is B flat major - flats, though the
    // first chord alone (F two down: Eb) would have said the same here;
    // one up is Db: flats, where F one up (F#) would have said sharps.
    const source = song('F', 'G', 'C', 'am');
    expect(transposeChordPro(source, 1, 'hungarian', 'C')).toBe(song('Gb', 'Ab', 'Db', 'bm'));
    expect(transposeChordPro(source, 1, 'hungarian')).toBe(song('F#', 'G#', 'C#', 'a#m'));
  });
});
