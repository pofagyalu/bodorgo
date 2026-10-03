import { chordsOverLyrics, toSongbookChord } from './paste-chords';

// The words here are made up for the tests.
describe('toSongbookChord', () => {
  it('writes B as H, B♭ as B, and minors in lower case', () => {
    expect(toSongbookChord('B')).toBe('H');
    expect(toSongbookChord('Bb')).toBe('B');
    expect(toSongbookChord('Bm')).toBe('hm');
    expect(toSongbookChord('Bbm7')).toBe('bm7');
    expect(toSongbookChord('Am')).toBe('am');
    expect(toSongbookChord('F#m7')).toBe('f#m7');
    expect(toSongbookChord('Am7/G')).toBe('am7/G');
    expect(toSongbookChord('G/B')).toBe('G/H');
    expect(toSongbookChord('C/Bb')).toBe('C/B');
  });

  it('leaves majors, and what is no chord, alone', () => {
    expect(toSongbookChord('Cmaj7')).toBe('Cmaj7');
    expect(toSongbookChord('Dsus4')).toBe('Dsus4');
    expect(toSongbookChord('x2')).toBe('x2');
  });
});

describe('chordsOverLyrics', () => {
  it('writes each chord into the words at the letter it stood over', () => {
    const pasted = ['Am        F', 'Lent a völgyben ég a tűz'].join('\n');
    expect(chordsOverLyrics(pasted)).toBe('[am]Lent a völgy[F]ben ég a tűz');
  });

  it('puts a chord over a space or a word end on the next word', () => {
    const pasted = ['C    G', 'Kint a réten'].join('\n');
    expect(chordsOverLyrics(pasted)).toBe('[C]Kint [G]a réten');
  });

  it('puts the chords past the words after them', () => {
    const pasted = ['C          G  Am', 'Esik'].join('\n');
    expect(chordsOverLyrics(pasted)).toBe('[C]Esik [G] [am]');
  });

  it('keeps labels, and writes a line of chords without words one after the other', () => {
    const pasted = [
      '[Intro]',
      'Am  F  C  G',
      '',
      '[Verse 1]',
      'Am     F',
      'Hull a hó ma',
      '',
      '',
      '',
      '[Chorus]',
      'C   G',
      'Ragyog',
    ].join('\r\n');
    expect(chordsOverLyrics(pasted)).toBe(
      [
        '[Intro]',
        '[am] [F] [C] [G]',
        '',
        '[Verse 1]',
        '[am]Hull a [F]hó ma',
        '',
        '[Chorus]',
        // "gy" is one consonant: the syllable starts before it.
        '[C]Ra[G]gyog',
      ].join('\n'),
    );
  });

  it('drops the lines of tablature', () => {
    const pasted = ['e|---3---0---|', 'B|---1---1---|', 'C    G', 'Kint a réten'].join('\n');
    expect(chordsOverLyrics(pasted)).toBe('[C]Kint [G]a réten');
  });

  it("keeps the chords as they are where they are the songbook's own already", () => {
    const pasted = ['am   H7', 'Kint a réten', 'B', 'Esik'].join('\n');
    expect(chordsOverLyrics(pasted)).toBe('[am]Kint [H7]a réten\n[B]Esik');
  });

  it('reads tabs as the way to the next eighth column', () => {
    const pasted = ['C\tG', 'Kint a réten jár'].join('\n');
    expect(chordsOverLyrics(pasted)).toBe('[C]Kint a [G]réten jár');
  });

  it('leaves plain words and ChordPro alone', () => {
    expect(chordsOverLyrics('Kint a réten\nEsik az eső')).toBeNull();
    expect(chordsOverLyrics('[am]Kint a [F]réten')).toBeNull();
    // One "A" alone may be a word.
    expect(chordsOverLyrics('A\nrét')).toBeNull();
  });
});
