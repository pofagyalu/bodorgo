// The editor's helpers on a song's ChordPro text: each takes the text and
// the selection, and gives back the new text and where the cursor goes.

export interface TextEdit {
  text: string;
  start: number;
  end: number;
}

// The [chord] the cursor stands in (or right beside), on its own line.
function chordAt(text: string, cursor: number): { from: number; to: number } | null {
  const lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
  const nextBreak = text.indexOf('\n', cursor);
  const lineEnd = nextBreak < 0 ? text.length : nextBreak;
  const chord = /\[[^\]\n]*\]/g;
  const line = text.slice(lineStart, lineEnd);
  for (let m = chord.exec(line); m; m = chord.exec(line)) {
    const from = lineStart + m.index;
    const to = from + m[0].length;
    if (cursor >= from && cursor <= to) return { from, to };
  }
  return null;
}

// Moves the chord under the cursor one letter left (-1) or right (+1) in
// its line - for setting it over the right syllable. Never past the line's
// end, and it steps over a neighbouring chord whole. null: no chord there,
// or nowhere to go.
export function nudgeChord(text: string, cursor: number, by: -1 | 1): TextEdit | null {
  const at = chordAt(text, cursor);
  if (!at) return null;
  const chord = text.slice(at.from, at.to);
  let from: number;
  if (by < 0) {
    if (at.from === 0 || text[at.from - 1] === '\n') return null;
    // What it steps over: one letter, or the whole chord before it.
    const before = text[at.from - 1] === ']' ? text.lastIndexOf('[', at.from - 1) : at.from - 1;
    from = before < 0 ? at.from - 1 : before;
    text = text.slice(0, from) + chord + text.slice(from, at.from) + text.slice(at.to);
  } else {
    if (at.to >= text.length || text[at.to] === '\n') return null;
    const closing = text[at.to] === '[' ? text.indexOf(']', at.to) : -1;
    const after = closing < 0 ? at.to + 1 : closing + 1;
    text = text.slice(0, at.from) + text.slice(at.to, after) + chord + text.slice(after);
    from = at.from + (after - at.to);
  }
  // The cursor stays in the chord, so the next nudge moves it again.
  const inside = from + Math.min(Math.max(cursor - at.from, 1), chord.length - 1);
  return { text, start: inside, end: inside };
}

// An empty [] at the cursor (or around the selection), the cursor in it.
export function insertChord(text: string, start: number, end: number): TextEdit {
  const chosen = text.slice(start, end);
  return {
    text: `${text.slice(0, start)}[${chosen}]${text.slice(end)}`,
    start: start + 1,
    end: start + 1 + chosen.length,
  };
}

// The selected lines (or the cursor's line) marked as the chorus.
export function wrapChorus(text: string, start: number, end: number): TextEdit {
  const from = text.lastIndexOf('\n', start - 1) + 1;
  const nextBreak = text.indexOf('\n', Math.max(end, start));
  const to = nextBreak < 0 ? text.length : nextBreak;
  const open = '{start_of_chorus}\n';
  const wrapped = `${open}${text.slice(from, to)}\n{end_of_chorus}`;
  return {
    text: text.slice(0, from) + wrapped + text.slice(to),
    start: from + open.length,
    end: from + open.length + (to - from),
  };
}

// An empty six-string tab to type into: the strings from the thinnest
// down, as tabs are written.
const EMPTY_TAB = ['e', 'B', 'G', 'D', 'A', 'E'].map((s) => `${s}|${'-'.repeat(32)}|`).join('\n');

// A guitar tab ({start_of_tab} … {end_of_tab} - chordpro.ts): the selected
// lines (or the cursor's line) marked as one - a tab pasted in from
// elsewhere -, or, on an empty line with nothing selected, six empty
// strings to type on. The selection is left on the tab's lines.
export function wrapTab(text: string, start: number, end: number): TextEdit {
  const from = text.lastIndexOf('\n', start - 1) + 1;
  const nextBreak = text.indexOf('\n', Math.max(end, start));
  const to = nextBreak < 0 ? text.length : nextBreak;
  const chosen = text.slice(from, to);
  const lines = chosen.trim() ? chosen : EMPTY_TAB;
  const open = '{start_of_tab}\n';
  return {
    text: `${text.slice(0, from)}${open}${lines}\n{end_of_tab}${text.slice(to)}`,
    start: from + open.length,
    end: from + open.length + lines.length,
  };
}

const SCREEN_MARK = '{screen}';
const isScreenMark = (line: string | undefined) =>
  line !== undefined && /^\{\s*screen\s*\}$/i.test(line.trim());
const isBlank = (line: string | undefined) => line !== undefined && !line.trim();

// {screen} set where the cursor is, standing alone - an empty line above
// it and one under it: over the line the cursor is in, or, on an empty
// line, right there. From the mark to the end of the song the chords are
// for the screen only, the PDF prints the words alone (chordpro.ts).
// Pressed again - the cursor on the mark, on the empty line under it, or on
// the first line after that -, it takes the mark off, and the empty line
// it brought. The cursor stays in the words it stood in (on an empty line:
// at the mark's end).
export function toggleScreenOnly(text: string, cursor: number): TextEdit {
  const lines = text.split('\n');
  // The line the cursor is in, and how far along it.
  let at = 0;
  let row = 0;
  while (row < lines.length - 1 && at + lines[row].length < cursor) {
    at += lines[row].length + 1;
    row += 1;
  }
  let column = cursor - at;

  // The mark this press takes off, if there is one at the cursor.
  const marked = isScreenMark(lines[row])
    ? row
    : isScreenMark(lines[row - 1])
      ? row - 1
      : isBlank(lines[row - 1]) && isScreenMark(lines[row - 2])
        ? row - 2
        : -1;

  if (marked >= 0) {
    // Taking a line away at `index`: the cursor moves up with what is
    // under it - from the line itself, to the start of the next.
    const remove = (index: number) => {
      lines.splice(index, 1);
      if (row > index) row -= 1;
      else if (row === index) column = 0;
    };
    remove(marked);
    // The empty line it had under it, where one above it parts the verses
    // already (or the song starts there).
    if (isBlank(lines[marked]) && (marked === 0 || isBlank(lines[marked - 1]))) remove(marked);
    row = Math.min(row, lines.length - 1);
  } else if (lines[row].trim()) {
    const added = [SCREEN_MARK, ''];
    if (row > 0 && !isBlank(lines[row - 1])) added.unshift('');
    lines.splice(row, 0, ...added);
    row += added.length;
  } else {
    // On an empty line: that line stays above the mark.
    const added =
      isBlank(lines[row + 1]) || lines[row + 1] === undefined ? [SCREEN_MARK] : [SCREEN_MARK, ''];
    lines.splice(row + 1, 0, ...added);
    row += 1;
    column = SCREEN_MARK.length;
  }

  let start = 0;
  for (let i = 0; i < row; i += 1) start += lines[i].length + 1;
  const place = start + Math.min(column, lines[row]?.length ?? 0);
  return { text: lines.join('\n'), start: place, end: place };
}

const REPEAT_OPEN = '||:';
const REPEAT_CLOSE = ':||';

// The selected lines (or the cursor's line) between repeat signs:
// "||: … :||" - sung twice. On lines that are between them already, the
// signs are taken off. The cursor (or the selection) stays on the very
// words it was on. null: nothing but empty lines there.
export function toggleRepeat(text: string, start: number, end: number): TextEdit | null {
  const from = text.lastIndexOf('\n', start - 1) + 1;
  const nextBreak = text.indexOf('\n', Math.max(end, start));
  const to = nextBreak < 0 ? text.length : nextBreak;
  const chosen = text.slice(from, to);
  const inner = chosen.trim();
  if (!inner) return null;
  // Where the words begin and end among the chosen lines.
  const lead = chosen.length - chosen.trimStart().length;
  const wordsFrom = from + lead;
  const wordsTo = wordsFrom + inner.length;

  const has = inner.startsWith(REPEAT_OPEN) && inner.endsWith(REPEAT_CLOSE) && inner.length >= 6;
  let wrapped: string;
  // How far a place among the words moves.
  let shift: (at: number) => number;
  if (has) {
    const body = inner.slice(REPEAT_OPEN.length, -REPEAT_CLOSE.length);
    const cut = REPEAT_OPEN.length + (body.length - body.trimStart().length);
    wrapped = body.trim();
    const kept = wrapped.length;
    // Onto the words left: never before them, never past them.
    shift = (place) => from + Math.min(Math.max(place - wordsFrom - cut, 0), kept);
  } else {
    wrapped = `${REPEAT_OPEN} ${inner} ${REPEAT_CLOSE}`;
    const added = REPEAT_OPEN.length + 1;
    shift = (place) => from + added + Math.min(Math.max(place - wordsFrom, 0), wordsTo - wordsFrom);
  }
  return {
    text: text.slice(0, from) + wrapped + text.slice(to),
    start: shift(start),
    end: shift(end),
  };
}
