import { Block, BlockLine } from './chordpro';
import { parseChord } from './chords';

// The verses as they are printed: the lines after a {screen} mark
// (chordpro.ts - to the end of the song, or to a {print}) without their
// chords - their words alone, as if they had been written without them.
// What isn't a chord stays ("[Verse 2]", "[2x]": labels); a line that was
// chords and nothing else (an interlude) is left out, and so is a verse
// that has nothing left. A tab there is left out whole. The other lines
// are untouched.
export function withoutScreenChords(blocks: Block[]): Block[] {
  return blocks.flatMap((block) => {
    if (!block.lines.some((line) => line.type !== 'comment' && line.screenOnly)) return [block];
    const lines = block.lines.flatMap((line): BlockLine[] => {
      if (line.type === 'comment' || !line.screenOnly) return [line];
      // A tab has no words to keep: it is for the screen whole.
      if (line.type === 'tab') return [];
      const segments = line.segments
        .map((s) => (s.chord !== undefined && parseChord(s.chord) ? { text: s.text } : s))
        // A chord that stood over nothing leaves nothing behind.
        .filter((s) => s.chord !== undefined || s.text);
      // Pieces of text side by side are one piece again.
      const joined = segments.reduce<typeof segments>((all, s) => {
        const last = all[all.length - 1];
        if (last && last.chord === undefined && s.chord === undefined) {
          all[all.length - 1] = { text: last.text + s.text };
        } else all.push(s);
        return all;
      }, []);
      if (!joined.some((s) => s.chord !== undefined || s.text.trim())) return [];
      return [{ type: line.type, segments: joined }];
    });
    return lines.length ? [{ ...block, lines }] : [];
  });
}
