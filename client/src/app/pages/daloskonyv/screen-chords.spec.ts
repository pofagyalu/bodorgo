import { Block, parseChordPro, toBlocks } from './chordpro';
import { withoutScreenChords } from './screen-chords';

// The words here are made up for the tests. A verse is written back as
// its lines of text, chords and labels in brackets again.
const show = (blocks: Block[]) =>
  blocks.map((block) =>
    block.lines.map((line) =>
      line.type === 'comment'
        ? `{${line.text}}`
        : line.type === 'tab'
          ? line.text
          : line.segments
              .map((s) => (s.chord === undefined ? '' : `[${s.chord}]`) + s.text)
              .join(''),
    ),
  );

const blocksOf = (source: string) => toBlocks(parseChordPro(source).lines);
const printed = (source: string) => show(withoutScreenChords(blocksOf(source)));

describe('{screen} and {print}', () => {
  // Which lines of words and chords are for the screen only.
  const marks = (source: string) =>
    parseChordPro(source).lines.flatMap((line) =>
      line.type === 'lyrics' || line.type === 'chords-only' ? [!!line.screenOnly] : [],
    );

  it('marks every line from {screen} to the end of the song', () => {
    const song = ['[C]Egy', '', '{screen}', '[C]Kettő', '', '[G]Három', '[am]Négy'].join('\n');
    expect(marks(song)).toEqual([false, true, true, true]);
    // The mark itself is no line of the song.
    expect(show(blocksOf(song))).toEqual([['[C]Egy'], ['[C]Kettő'], ['[G]Három', '[am]Négy']]);
  });

  it('prints again from {print}', () => {
    const song = [
      '[C]Egy',
      '{screen}',
      '[C]Kettő',
      '',
      '{print}',
      '[G]Három',
      '{ Screen }',
      'Négy',
    ];
    expect(marks(song.join('\n'))).toEqual([false, true, false, true]);
  });

  it('leaves a song without the mark as it was', () => {
    const lines = parseChordPro('[C]Egy\n\n[G]Kettő').lines;
    expect(lines.some((line) => 'screenOnly' in line)).toBe(false);
  });
});

describe('withoutScreenChords', () => {
  it('prints the lines after the mark with their words alone, the others as they are', () => {
    const song = [
      '[C]Kint a [G]réten',
      '[am]Esik az e[F]ső',
      '',
      '{screen}',
      '[C]Bent a [G]házban',
      '[am]Alszik a macs[F]ka',
      '',
      '{soc}',
      '[F]Hej, [G]hó',
      '{eoc}',
    ].join('\n');
    expect(printed(song)).toEqual([
      ['[C]Kint a [G]réten', '[am]Esik az e[F]ső'],
      ['Bent a házban', 'Alszik a macska'],
      ['Hej, hó'],
    ]);
  });

  it('can start in the middle of a verse, and end at {print}', () => {
    const song = [
      '[C]Kint a réten',
      '{screen}',
      '[G]Esik az eső',
      '',
      '{print}',
      '[am]Bent a házban',
    ].join('\n');
    expect(printed(song)).toEqual([['[C]Kint a réten', 'Esik az eső'], ['[am]Bent a házban']]);
  });

  it('keeps labels and comments, drops the lines that were chords alone', () => {
    const song = [
      '{screen}',
      '[Verse 2]',
      '{c: halkan}',
      '[C]Bent a [G]házban [2x]',
      '[am] [F] [G]',
    ].join('\n');
    expect(printed(song)).toEqual([['[Verse 2]', '{halkan}', 'Bent a házban [2x]']]);
  });

  it('leaves out a verse that was nothing but chords', () => {
    const song = ['[C]Kint a réten', '', '{screen}', '[am] [F] [G]', '', 'Vége'].join('\n');
    expect(printed(song)).toEqual([['[C]Kint a réten'], ['Vége']]);
  });
});
