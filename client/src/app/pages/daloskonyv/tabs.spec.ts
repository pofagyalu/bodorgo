import { ComponentFixture, TestBed } from '@angular/core/testing';

import { wrapTab } from './chord-text';
import { parseChordPro, plainLyrics, toBlocks } from './chordpro';
import { withoutScreenChords } from './screen-chords';
import { SongSheet } from './song-sheet/song-sheet';

// Guitar tabs in a song: {start_of_tab} … {end_of_tab}, as ChordPro has it.

const TAB = ['e|--0---3---|', 'B|----1-----|'];

const song = (...lines: string[]) => lines.join('\n');

describe('a tab in the song text', () => {
  it('keeps its lines letter for letter', () => {
    const { lines } = parseChordPro(song('{start_of_tab}', ...TAB, '{end_of_tab}', '[Am]Szöveg'));
    expect(lines).toEqual([
      { type: 'tab', text: TAB[0] },
      { type: 'tab', text: TAB[1] },
      { type: 'lyrics', segments: [{ chord: 'Am', text: 'Szöveg' }] },
    ]);
  });

  it('knows the short names too, in any case', () => {
    const { lines } = parseChordPro(song('{SOT}', TAB[0], '{ eot }', 'Szöveg'));
    expect(lines.map((l) => l.type)).toEqual(['tab', 'lyrics']);
  });

  it('reads nothing inside it as a chord, a directive or the end of a verse', () => {
    const inside = ['   [Am] nem akkord', '{comment: nem megjegyzés}', '', '{soc}', TAB[0]];
    const { lines } = parseChordPro(song('{sot}', ...inside, '{eot}'));
    expect(lines).toEqual(inside.map((text) => ({ type: 'tab', text })));
    // One piece on the page, the empty line and all.
    expect(toBlocks(lines)).toHaveLength(1);
  });

  it('puts its label over it as a comment', () => {
    const labels = ['{start_of_tab: Intro}', '{sot: label="Intro"}', '{sot:Intro}'];
    for (const start of labels) {
      expect(parseChordPro(song(start, TAB[0], '{eot}')).lines).toEqual([
        { type: 'comment', text: 'Intro' },
        { type: 'tab', text: TAB[0] },
      ]);
    }
  });

  it('runs to the end of the song when it is never closed', () => {
    const { lines } = parseChordPro(song('Szöveg', '{sot}', ...TAB));
    expect(lines.map((l) => l.type)).toEqual(['lyrics', 'tab', 'tab']);
  });

  it('stands in a verse of its own, or right on the verse it touches', () => {
    const apart = toBlocks(parseChordPro(song('{sot}', ...TAB, '{eot}', '', 'Szöveg')).lines);
    expect(apart.map((b) => b.lines.map((l) => l.type))).toEqual([['tab', 'tab'], ['lyrics']]);
    const touching = toBlocks(parseChordPro(song('{sot}', TAB[0], '{eot}', 'Szöveg')).lines);
    expect(touching.map((b) => b.lines.map((l) => l.type))).toEqual([['tab', 'lyrics']]);
  });

  it('is no part of the words the search looks through', () => {
    expect(plainLyrics(song('{sot: Intro}', ...TAB, '{eot}', '[C]Első sor'))).toEqual(['Első sor']);
  });

  it('is left out of print whole after a {screen}', () => {
    const blocks = toBlocks(
      parseChordPro(
        song('{sot}', TAB[0], '{eot}', '', '{screen}', '{sot}', TAB[1], '{eot}', '[C]Szó'),
      ).lines,
    );
    const printed = withoutScreenChords(blocks);
    expect(printed.map((b) => b.lines)).toEqual([
      [{ type: 'tab', text: TAB[0] }],
      [{ type: 'lyrics', segments: [{ text: 'Szó' }] }],
    ]);
    // Nothing but a tab after the mark: the verse goes with it.
    const only = toBlocks(
      parseChordPro(song('Szó', '', '{screen}', '{sot}', TAB[0], '{eot}')).lines,
    );
    expect(withoutScreenChords(only)).toHaveLength(1);
  });
});

describe('wrapTab', () => {
  it('gives six empty strings on an empty line', () => {
    const edit = wrapTab('Első sor\n\nUtolsó sor', 9, 9);
    const lines = edit.text.split('\n');
    expect(lines[0]).toBe('Első sor');
    expect(lines[1]).toBe('{start_of_tab}');
    expect(lines.slice(2, 8).map((l) => l[0])).toEqual(['e', 'B', 'G', 'D', 'A', 'E']);
    expect(new Set(lines.slice(2, 8).map((l) => l.length)).size).toBe(1);
    expect(lines[8]).toBe('{end_of_tab}');
    expect(lines[9]).toBe('Utolsó sor');
    // The six strings are selected.
    expect(edit.text.slice(edit.start, edit.end).split('\n')).toEqual(lines.slice(2, 8));
    // And the song reads them as a tab.
    expect(parseChordPro(edit.text).lines.filter((l) => l.type === 'tab')).toHaveLength(6);
  });

  it('marks the selected lines as a tab, whole lines only', () => {
    const text = song('Szöveg', ...TAB, 'Vége');
    const edit = wrapTab(text, text.indexOf('--0'), text.indexOf('1-----'));
    expect(edit.text).toBe(song('Szöveg', '{start_of_tab}', ...TAB, '{end_of_tab}', 'Vége'));
    expect(edit.text.slice(edit.start, edit.end)).toBe(TAB.join('\n'));
  });

  it("marks the cursor's own line when nothing is selected", () => {
    const edit = wrapTab(song('Szöveg', TAB[0]), 10, 10);
    expect(edit.text).toBe(song('Szöveg', '{start_of_tab}', TAB[0], '{end_of_tab}'));
  });
});

describe('a tab on the song page', () => {
  let fixture: ComponentFixture<SongSheet>;

  function show(chordpro: string, transpose = 0) {
    fixture = TestBed.createComponent(SongSheet);
    fixture.componentRef.setInput('chordpro', chordpro);
    fixture.componentRef.setInput('transpose', transpose);
    fixture.componentRef.setInput('instrument', 'guitar');
    fixture.componentRef.setInput('showDiagrams', true);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  // A tab's rows as they read on the page.
  const rowsOf = (tab: Element) => [...tab.querySelectorAll('.tab-row')].map((r) => r.textContent);

  it('is one block of its lines, as they were typed', () => {
    const el = show(song('{sot: Intro}', ...TAB, '{eot}', '[C]Első sor'));
    const tabs = el.querySelectorAll('.tab');
    expect(tabs).toHaveLength(1);
    expect(rowsOf(tabs[0])).toEqual(TAB);
    expect(el.querySelector('.comment')!.textContent).toBe('Intro');
    // The words after it are drawn as ever.
    expect(el.querySelector('.line')!.textContent).toContain('Első sor');
  });

  it('gives every letter a cell of its own, so the strings line up in any font', () => {
    const el = show(song('{sot}', 'e|--10--|', 'G|--7---|', '', 'D|-\t|', '{eot}'));
    const cells = [...el.querySelectorAll('.tab-row')].map((row) =>
      [...row.querySelectorAll('.tab-cell')].map((cell) => cell.textContent),
    );
    // One letter a cell - the two digits of a fret each their own.
    expect(cells[0]).toEqual(['e', '|', '-', '-', '1', '0', '-', '-', '|']);
    expect(cells[1]).toHaveLength(9);
    // An empty row stays a row; a tab key is four spaces.
    expect(cells[2]).toEqual([]);
    expect(cells[3]).toEqual(['D', '|', '-', ' ', ' ', ' ', ' ', '|']);
  });

  it('keeps two tabs apart', () => {
    const el = show(song('{sot}', TAB[0], '{eot}', 'Szöveg', '{sot}', TAB[1], '{eot}'));
    expect([...el.querySelectorAll('.tab')].map((t) => rowsOf(t))).toEqual([[TAB[0]], [TAB[1]]]);
  });

  it('stays as it is when the chords are moved to another key', () => {
    const el = show(song('{sot}', ...TAB, '{eot}', '[C]Első sor'), 2);
    expect(rowsOf(el.querySelector('.tab')!)).toEqual(TAB);
    expect(el.querySelector('.chord')!.textContent).toContain('D');
  });

  it('adds no chord to the diagrams', () => {
    show(song('{sot}', '[G] e|--3--|', '{eot}', '[C]Első sor'));
    expect(fixture.componentInstance.diagrams().map((d) => d.name)).toEqual(['C']);
  });
});
