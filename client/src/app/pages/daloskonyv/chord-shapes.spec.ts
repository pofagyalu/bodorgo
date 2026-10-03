import { chordShape, uniqueChords } from './chord-shapes';

const frets = (name: string, instrument: 'guitar' | 'ukulele') =>
  chordShape(name, instrument, 'hungarian')
    ?.frets.map((f) => (f < 0 ? 'x' : f))
    .join('');

describe('chordShape: guitar', () => {
  it('holds the sus2 chords down by the nut, not high up the neck', () => {
    expect(frets('Gsus2', 'guitar')).toBe('300033');
    expect(frets('Dsus2', 'guitar')).toBe('xx0230');
    expect(frets('Asus2', 'guitar')).toBe('x02200');
    expect(frets('Csus2', 'guitar')).toBe('x30033');
    expect(frets('Esus2', 'guitar')).toBe('024400');
    // The others: the A shape slid up.
    expect(frets('Hsus2', 'guitar')).toBe('x24422');
  });

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

  it('puts a slash chord’s bass note lowest', () => {
    // A minor with C, with G, with F in the bass.
    expect(frets('am/C', 'guitar')).toBe('x32210');
    expect(frets('am/G', 'guitar')).toBe('302210');
    expect(frets('am/F', 'guitar')).toBe('102210');
    expect(frets('G/H', 'guitar')).toBe('x20003');
    expect(frets('C/G', 'guitar')).toBe('332010');
    expect(frets('D/F#', 'guitar')).toBe('2x0232');
    expect(frets('dm/H', 'guitar')).toBe('x20231');
    expect(frets('G/E', 'guitar')).toBe('020003');
    // The bass is the chord's own lowest note already: nothing changes.
    expect(frets('am/A', 'guitar')).toBe('x02210');
    expect(frets('C/C', 'guitar')).toBe('x32010');
  });

  it('keeps the barre on the strings it still reaches', () => {
    // F over C: the low E isn't played, the bar starts at the D string.
    expect(frets('F/C', 'guitar')).toBe('x33211');
    expect(chordShape('F/C', 'guitar', 'hungarian')?.barre).toEqual({ fret: 1, from: 4, to: 5 });
  });

  it('shows just the chord on the ukulele', () => {
    expect(frets('am/C', 'ukulele')).toBe('2000');
    expect(frets('G/H', 'ukulele')).toBe('0232');
  });

  it('falls back to the plainer chord', () => {
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
