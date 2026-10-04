import { insertChord, nudgeChord, toggleRepeat, toggleScreenOnly, wrapChorus } from './chord-text';

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

describe('toggleScreenOnly', () => {
  // "|" marks the cursor; the words are made up.
  const toggle = (marked: string) => {
    const cursor = marked.indexOf('|');
    const edit = toggleScreenOnly(marked.replace('|', ''), cursor);
    return `${edit.text.slice(0, edit.start)}|${edit.text.slice(edit.start)}`;
  };

  it('puts the mark over the cursor’s line, standing alone between empty lines', () => {
    // At a verse's first line: the empty line above it is there already.
    expect(toggle('első vers\n\n[C]másik |vers\nvége')).toBe(
      'első vers\n\n{screen}\n\n[C]másik |vers\nvége',
    );
    // In the middle of a verse: an empty line on both sides.
    expect(toggle('egy\nket|tő')).toBe('egy\n\n{screen}\n\nket|tő');
    // The first line of the song.
    expect(toggle('|egy\nkettő')).toBe('{screen}\n\n|egy\nkettő');
  });

  it('on an empty line puts it where the cursor is', () => {
    expect(toggle('egy\n|\nkettő')).toBe('egy\n\n{screen}|\n\nkettő');
    // The song's last, empty line.
    expect(toggle('egy\n|')).toBe('egy\n\n{screen}|');
  });

  it('takes the mark off again, with the empty line it brought', () => {
    // From the first line after it.
    expect(toggle('első vers\n\n{screen}\n\n[C]másik |vers\nvége')).toBe(
      'első vers\n\n[C]másik |vers\nvége',
    );
    // From the mark itself, and from the empty line under it.
    expect(toggle('egy\n\n{scr|een}\n\nkettő')).toBe('egy\n\n|kettő');
    expect(toggle('egy\n\n{screen}\n|\nkettő')).toBe('egy\n\n|kettő');
    // At the song's top.
    expect(toggle('{screen}\n\n|egy')).toBe('|egy');
    // A mark typed without empty lines around it: only the mark goes.
    expect(toggle('egy\n{ screen }\nket|tő')).toBe('egy\nket|tő');
  });

  it('gives back the text as it was when pressed twice at a verse’s start', () => {
    for (const text of ['első\n\n[C]másik |vers\nvége', '|egy\nkettő', 'egy\n|\nkettő']) {
      const once = toggle(text);
      // On an empty line the cursor ends on the line that follows.
      expect(toggle(once).replace('|', '')).toBe(text.replace('|', ''));
    }
    // In the middle of a verse the mark parted it in two: the gap stays.
    expect(toggle(toggle('egy\nket|tő'))).toBe('egy\n\nket|tő');
  });
});

describe('toggleRepeat', () => {
  // "^" marks the cursor (a bar is part of the signs); the words are made up.
  const toggle = (marked: string) => {
    const cursor = marked.indexOf('^');
    const edit = toggleRepeat(marked.replace('^', ''), cursor, cursor);
    return edit && `${edit.text.slice(0, edit.start)}^${edit.text.slice(edit.start)}`;
  };

  it('puts the cursor’s line between repeat signs, the cursor on the same letter', () => {
    expect(toggle('egy\n[C]ket^tő sor\nhárom')).toBe('egy\n||: [C]ket^tő sor :||\nhárom');
    expect(toggle('^kettő')).toBe('||: ^kettő :||');
    expect(toggle('kettő^')).toBe('||: kettő^ :||');
  });

  it('puts the selected lines between one pair of signs, the selection kept', () => {
    const text = 'egy\nkettő\nhárom\nnégy';
    const edit = toggleRepeat(text, 5, 13);
    expect(edit?.text).toBe('egy\n||: kettő\nhárom :||\nnégy');
    // The same letters are selected as before.
    expect(edit?.text.slice(edit.start, edit.end)).toBe(text.slice(5, 13));
  });

  it('takes the signs off lines that have them, the cursor on the same letter', () => {
    expect(toggle('egy\n||: [C]ket^tő sor :||\nhárom')).toBe('egy\n[C]ket^tő sor\nhárom');
    expect(toggleRepeat('||:kettő\nhárom:||', 0, 16)?.text).toBe('kettő\nhárom');
    // The cursor in a sign: onto the words' nearest end.
    expect(toggle('|^|: kettő :||')).toBe('^kettő');
    expect(toggle('||: kettő :|^|')).toBe('kettő^');
  });

  it('does nothing on an empty line', () => {
    expect(toggle('egy\n^\nkettő')).toBeNull();
  });
});
