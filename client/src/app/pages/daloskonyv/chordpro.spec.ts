import { parseChordPro, toBlocks, toWords } from './chordpro';

describe('parseChordPro', () => {
  it('puts each chord before the text sung from it', () => {
    const { lines } = parseChordPro('[Am]Első sor szö[F]vege itt');
    expect(lines).toEqual([
      {
        type: 'lyrics',
        segments: [
          { chord: 'Am', text: 'Első sor szö' },
          { chord: 'F', text: 'vege itt' },
        ],
      },
    ]);
  });

  it('keeps the text before the first chord, and a chord at the end of the line', () => {
    const { lines } = parseChordPro('Hegyen-völgyön [G]át, [C]');
    expect(lines[0]).toEqual({
      type: 'lyrics',
      segments: [
        { text: 'Hegyen-völgyön ' },
        { chord: 'G', text: 'át, ' },
        { chord: 'C', text: '' },
      ],
    });
  });

  it('knows a line of chords with no words', () => {
    expect(parseChordPro('[C] [G] [Am]').lines[0].type).toBe('chords-only');
    expect(parseChordPro('csak szöveg').lines[0]).toEqual({
      type: 'lyrics',
      segments: [{ text: 'csak szöveg' }],
    });
  });

  it('reads the directives, long and short, and skips the unknown ones', () => {
    const song = parseChordPro(
      [
        '{title: Dal címe}',
        '{artist: Előadó}',
        '{key: C}',
        '{soc}',
        '[F]Refrén',
        '{end_of_chorus}',
        '{c: 2x}',
        '{start_of_verse}',
        '{eov}',
      ].join('\r\n'),
    );
    expect(song.title).toBe('Dal címe');
    expect(song.artist).toBe('Előadó');
    expect(song.lines.map((l) => l.type)).toEqual([
      'section-start',
      'lyrics',
      'section-end',
      'comment',
      'section-start',
      'section-end',
    ]);
    expect(song.lines[3]).toEqual({ type: 'comment', text: '2x' });
    expect(song.lines[0]).toEqual({ type: 'section-start', section: 'chorus' });
    expect(song.lines[4]).toEqual({ type: 'section-start', section: 'verse' });
  });

  it('marks the empty lines', () => {
    expect(parseChordPro('[C]egy\n\n[G]kettő').lines.map((l) => l.type)).toEqual([
      'lyrics',
      'empty',
      'lyrics',
    ]);
  });
});

describe('toBlocks', () => {
  it('parts the verses at empty lines and knows the chorus', () => {
    const { lines } = parseChordPro(
      '[C]egy\n[G]kettő\n\n{start_of_chorus}\n[F]refrén\n{end_of_chorus}\n{comment: 2x}\n\n[C]három',
    );
    const blocks = toBlocks(lines);
    expect(blocks.map((b) => [b.chorus, b.lines.length])).toEqual([
      [false, 2],
      [true, 1],
      [false, 1],
      [false, 1],
    ]);
    expect(blocks[2].lines[0]).toEqual({ type: 'comment', text: '2x' });
  });
});

describe('toWords', () => {
  const words = (line: string) => {
    const first = parseChordPro(line).lines[0];
    return first.type === 'lyrics' || first.type === 'chords-only' ? toWords(first.segments) : [];
  };

  it('cuts a line by words, the chord over its own syllable', () => {
    expect(words('[C]Elindultunk [G]reggel, a dombon')).toEqual([
      [{ chord: 'C', text: 'Elindultunk ' }],
      [{ chord: 'G', text: 'reggel, ' }],
      [{ text: 'a ' }],
      [{ text: 'dombon' }],
    ]);
  });

  it('keeps a word with a chord in its middle in one piece', () => {
    expect(words('Hej, bódor[G]gók, [C]menjünk')).toEqual([
      [{ text: 'Hej, ' }],
      [{ text: 'bódor' }, { chord: 'G', text: 'gók, ' }],
      [{ chord: 'C', text: 'menjünk' }],
    ]);
  });

  it('gives a chord over nothing a piece of its own', () => {
    expect(words('[G]át, [C]')).toEqual([
      [{ chord: 'G', text: 'át, ' }],
      [{ chord: 'C', text: '' }],
    ]);
    expect(words('[C] [G]')).toEqual([
      [{ chord: 'C', text: '' }],
      [{ text: ' ' }],
      [{ chord: 'G', text: '' }],
    ]);
  });
});
