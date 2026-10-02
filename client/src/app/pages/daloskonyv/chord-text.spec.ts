import { insertChord, nudgeChord, wrapChorus } from './chord-text';

describe('nudgeChord', () => {
  // "|" marks the cursor.
  const nudge = (marked: string, by: -1 | 1) => {
    const cursor = marked.indexOf('|');
    const edit = nudgeChord(marked.replace('|', ''), cursor, by);
    return edit && `${edit.text.slice(0, edit.start)}|${edit.text.slice(edit.start)}`;
  };

  it('moves the chord under the cursor a letter right or left', () => {
    expect(nudge('Nagy [G|]esők jönnek', 1)).toBe('Nagy e[G|]sők jönnek');
    expect(nudge('Nagy e[G|]sők jönnek', -1)).toBe('Nagy [G|]esők jönnek');
    // The cursor may stand at either bracket, or in a longer name.
    expect(nudge('a|[Am7]b', 1)).toBe('ab[|Am7]');
    expect(nudge('ab[Am7]|', -1)).toBe('a[Am7|]b');
    expect(nudge('a[A|m7]b', 1)).toBe('ab[A|m7]');
  });

  it('stays in its line', () => {
    expect(nudge('[C|]első\nmásodik', -1)).toBeNull();
    expect(nudge('első [C|]\nmásodik', 1)).toBeNull();
    expect(nudge('első\n[C|]második', -1)).toBeNull();
    expect(nudge('vége [C|]', 1)).toBeNull();
  });

  it('steps over a neighbouring chord whole', () => {
    expect(nudge('[C|][G]szó', 1)).toBe('[G][C|]szó');
    expect(nudge('[C][G|]szó', -1)).toBe('[G|][C]szó');
  });

  it('does nothing without a chord under the cursor', () => {
    expect(nudge('Nagy| [G]esők', 1)).toBeNull();
    expect(nudge('', 1)).toBeNull();
  });
});

describe('insertChord', () => {
  it('puts an empty chord at the cursor, the cursor in it', () => {
    expect(insertChord('Nagy esők', 5, 5)).toEqual({ text: 'Nagy []esők', start: 6, end: 6 });
  });

  it('wraps the selection', () => {
    expect(insertChord('Am esők', 0, 2)).toEqual({ text: '[Am] esők', start: 1, end: 3 });
  });
});

describe('wrapChorus', () => {
  it('marks the selected lines as the chorus', () => {
    const text = 'vers\nrefrén egy\nrefrén kettő\nvers';
    const edit = wrapChorus(text, 7, 20);
    expect(edit.text).toBe(
      'vers\n{start_of_chorus}\nrefrén egy\nrefrén kettő\n{end_of_chorus}\nvers',
    );
    expect(edit.text.slice(edit.start, edit.end)).toBe('refrén egy\nrefrén kettő');
  });

  it('takes the cursor’s line without a selection', () => {
    expect(wrapChorus('egy\nkettő', 5, 5).text).toBe(
      'egy\n{start_of_chorus}\nkettő\n{end_of_chorus}',
    );
  });
});
