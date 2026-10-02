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
