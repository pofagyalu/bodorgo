import { chordShape, uniqueChords } from './chord-shapes';

const frets = (name: string, instrument: 'guitar' | 'ukulele') =>
  chordShape(name, instrument, 'hungarian')
    ?.frets.map((f) => (f < 0 ? 'x' : f))
    .join('');

describe('chordShape: guitar', () => {
  it('knows the open chords', () => {
    expect(frets('C', 'guitar')).toBe('x32010');
    expect(frets('G', 'guitar')).toBe('320003');
    expect(frets('D', 'guitar')).toBe('xx0232');
    expect(frets('E', 'guitar')).toBe('022100');
    expect(frets('A', 'guitar')).toBe('x02220');
    expect(frets('D7', 'guitar')).toBe('xx0212');
    expect(frets('Cadd9', 'guitar')).toBe('x32030');
    expect(chordShape('C', 'guitar')?.barre).toBeNull();
  });

  it('reads the songbook’s lower-case minors', () => {
    expect(frets('am', 'guitar')).toBe('x02210');
    expect(frets('em', 'guitar')).toBe('022000');
    expect(frets('dm', 'guitar')).toBe('xx0231');
    expect(frets('am7', 'guitar')).toBe('x02010');
    expect(frets('em7', 'guitar')).toBe('020000');
  });

  it('builds the others as barre chords, the lower of the two families', () => {
    expect(frets('F', 'guitar')).toBe('133211');
    expect(chordShape('F', 'guitar')?.barre).toEqual({ fret: 1, from: 0, to: 5 });
    expect(frets('fm', 'guitar')).toBe('133111');
    expect(frets('F#m', 'guitar')).toBe('244222');
    expect(frets('cm', 'guitar')).toBe('x35543');
    expect(chordShape('cm', 'guitar')?.barre).toEqual({ fret: 3, from: 1, to: 5 });
    expect(frets('G#', 'guitar')).toBe('466544');
  });

  it('reads the Hungarian H and B', () => {
    expect(frets('H7', 'guitar')).toBe('x21202');
    expect(frets('hm', 'guitar')).toBe('x24432');
    expect(frets('B', 'guitar')).toBe('x13331');
    expect(frets('Bb', 'guitar')).toBe('x13331');
  });

  it('shows a slash chord’s chord, and falls back to the plainer chord', () => {
    expect(frets('G/H', 'guitar')).toBe('320003');
    expect(frets('Am9', 'guitar')).toBe('x02010');
    expect(frets('C-', 'guitar')).toBe('x35543');
    expect(frets('D4', 'guitar')).toBe('xx0233');
    expect(frets('Fmaj', 'guitar')).toBe('xx3210');
  });

  it('has nothing for what is not a chord', () => {
    expect(chordShape('2x', 'guitar')).toBeNull();
    expect(chordShape('N.C.', 'ukulele')).toBeNull();
  });
});

describe('chordShape: ukulele', () => {
  it('knows the open chords', () => {
    expect(frets('C', 'ukulele')).toBe('0003');
    expect(frets('am', 'ukulele')).toBe('2000');
    expect(frets('F', 'ukulele')).toBe('2010');
    expect(frets('G', 'ukulele')).toBe('0232');
    expect(frets('G7', 'ukulele')).toBe('0212');
    expect(frets('em', 'ukulele')).toBe('0432');
    expect(frets('Am7', 'ukulele')).toBe('0000');
    expect(frets('Cmaj7', 'ukulele')).toBe('0002');
  });

  it('slides a shape up for the others', () => {
    // B♭ is A one up, H is A two up.
    expect(frets('B', 'ukulele')).toBe('3211');
    expect(chordShape('B', 'ukulele', 'hungarian')?.barre).toEqual({ fret: 1, from: 2, to: 3 });
    expect(frets('H', 'ukulele')).toBe('4322');
    expect(frets('hm', 'ukulele')).toBe('4222');
    expect(frets('H7', 'ukulele')).toBe('2322');
    expect(frets('E', 'ukulele')).toBe('4442');
    expect(frets('C#', 'ukulele')).toBe('1114');
    expect(frets('F#m', 'ukulele')).toBe('2120');
  });

  it('repeats the dim and aug shapes along the neck', () => {
    expect(frets('C#dim', 'ukulele')).toBe('0101');
    expect(frets('E0', 'ukulele')).toBe('0101');
    expect(frets('Cdim', 'ukulele')).toBe('2323');
    expect(frets('Caug', 'ukulele')).toBe('1003');
    expect(frets('Eaug', 'ukulele')).toBe('1003');
  });
});

describe('uniqueChords', () => {
  it('lists each chord once, in the order of the song, without what is not a chord', () => {
    expect(uniqueChords(['G', 'D', 'em', 'C', 'G', '2x', 'em', ''], 'hungarian')).toEqual([
      'G',
      'D',
      'em',
      'C',
    ]);
  });
});
