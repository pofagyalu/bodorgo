import { CIRCLE, keyChords } from './keys';

describe('keyChords', () => {
  const row = (key: string) =>
    keyChords()
      .find((k) => k.key === key)
      ?.chords.join(' ');

  it('lists the seven chords of a key, minors in lower case', () => {
    expect(row('C')).toBe('C dm em F G am h°');
    expect(row('G')).toBe('G am hm C D em f#°');
    expect(row('D')).toBe('D em f#m G A hm c#°');
    expect(row('A')).toBe('A hm c#m D E f#m g#°');
    expect(row('E')).toBe('E f#m g#m A H c#m d#°');
  });

  it('writes the flat keys with flats, the Hungarian B for B flat', () => {
    expect(row('F')).toBe('F gm am B C dm e°');
    expect(row('B')).toBe('B cm dm Eb F gm a°');
    expect(row('Eb')).toBe('Eb fm gm Ab B cm d°');
  });

  it('has the twelve keys in the circle’s order', () => {
    expect(keyChords().map((k) => k.key)).toEqual([
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
    ]);
    expect(CIRCLE.map((k) => k.major[0])).toEqual(keyChords().map((k) => k.key));
  });
});
