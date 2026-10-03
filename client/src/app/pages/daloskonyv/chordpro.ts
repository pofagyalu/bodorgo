// A song's ChordPro text → lines the song page can draw. Chords stand in
// [brackets] right before the syllable they belong to:
//
//   [Am]Első sor szö[F]vege itt
//   {start_of_chorus}
//   [F]Refrén [G]sor [C]
//   {end_of_chorus}
//   {comment: 2x}
//
// Known directives: title/t, artist, comment/c, start_of_chorus/soc,
// end_of_chorus/eoc, start_of_verse/sov, end_of_verse/eov. Anything else in
// {braces} is skipped. An empty line parts the verses.

// A piece of a line: a chord (or none) and the text sung from it on.
export interface Segment {
  chord?: string;
  text: string;
}

export type Section = 'chorus' | 'verse';

export type SongLine =
  // 'chords-only': chords with no words under them (an intro, an ending).
  | { type: 'lyrics' | 'chords-only'; segments: Segment[] }
  | { type: 'comment'; text: string }
  | { type: 'empty' }
  | { type: 'section-start' | 'section-end'; section: Section };

export interface ParsedSong {
  title?: string;
  artist?: string;
  lines: SongLine[];
}

const DIRECTIVE = /^\{\s*([^:}]+?)\s*(?::\s*(.*?)\s*)?\}$/;

const SECTION_MARKS: Record<string, SongLine> = {
  start_of_chorus: { type: 'section-start', section: 'chorus' },
  soc: { type: 'section-start', section: 'chorus' },
  end_of_chorus: { type: 'section-end', section: 'chorus' },
  eoc: { type: 'section-end', section: 'chorus' },
  start_of_verse: { type: 'section-start', section: 'verse' },
  sov: { type: 'section-start', section: 'verse' },
  end_of_verse: { type: 'section-end', section: 'verse' },
  eov: { type: 'section-end', section: 'verse' },
};

export function parseChordPro(source: string): ParsedSong {
  const song: ParsedSong = { lines: [] };
  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      song.lines.push({ type: 'empty' });
      continue;
    }
    const directive = DIRECTIVE.exec(line.trim());
    if (directive) {
      const name = directive[1].toLowerCase();
      const value = directive[2] ?? '';
      if (name === 'title' || name === 't') song.title = value;
      else if (name === 'artist') song.artist = value;
      else if (name === 'comment' || name === 'c')
        song.lines.push({ type: 'comment', text: value });
      else if (SECTION_MARKS[name]) song.lines.push(SECTION_MARKS[name]);
      continue;
    }
    const segments = parseLine(line);
    const chordsOnly = segments.every((s) => !s.text.trim()) && segments.some((s) => s.chord);
    song.lines.push({ type: chordsOnly ? 'chords-only' : 'lyrics', segments });
  }
  return song;
}

// "[Am]Első szö[F]vege" → Am + "Első szö", F + "vege". Text before the
// first chord is a segment without one.
function parseLine(line: string): Segment[] {
  const segments: Segment[] = [];
  const chord = /\[([^\]]*)\]/g;
  let from = 0;
  let current: Segment = { text: '' };
  for (let m = chord.exec(line); m; m = chord.exec(line)) {
    current.text = line.slice(from, m.index);
    if (current.chord !== undefined || current.text) segments.push(current);
    current = { chord: m[1].trim(), text: '' };
    from = m.index + m[0].length;
  }
  current.text = line.slice(from);
  if (current.chord !== undefined || current.text) segments.push(current);
  return segments;
}

// --- For the page ---

export type BlockLine = Extract<SongLine, { type: 'lyrics' | 'chords-only' | 'comment' }>;

// A verse or a chorus: the lines between two empty lines (or two marks).
export interface Block {
  chorus: boolean;
  lines: BlockLine[];
}

export function toBlocks(lines: SongLine[]): Block[] {
  const blocks: Block[] = [];
  let inChorus = false;
  let current: Block | null = null;
  const close = () => {
    if (current?.lines.length) blocks.push(current);
    current = null;
  };
  for (const line of lines) {
    if (line.type === 'empty') close();
    else if ('section' in line) {
      close();
      if (line.section === 'chorus') inChorus = line.type === 'section-start';
    } else {
      current ??= { chorus: inChorus, lines: [] };
      current.lines.push(line);
    }
  }
  close();
  return blocks;
}

// A line's segments cut up by words, so a long line can wrap between words
// while every chord stays over its own syllable - and a word with a chord
// in its middle ("szö[F]vege") is never broken there. Each word is the
// pieces to draw side by side; a piece's text keeps its trailing space.
export function toWords(segments: Segment[]): Segment[][] {
  const words: Segment[][] = [];
  // The last word still waits for its end (no space after it yet).
  let open = false;
  const add = (piece: Segment) => {
    if (open) words[words.length - 1].push(piece);
    else words.push([piece]);
    open = piece.text !== '' && !/\s$/.test(piece.text);
  };
  for (const segment of segments) {
    const tokens = segment.text.match(/\S+\s*|\s+/g) ?? [];
    if (segment.chord !== undefined) {
      // A chord over nothing, or over a gap: a piece of its own.
      const first = tokens[0] && /\S/.test(tokens[0]) ? tokens.shift()! : '';
      add({ chord: segment.chord, text: first });
    }
    for (const token of tokens) add({ text: token });
  }
  return words;
}

// A song's words alone, line by line - no chords (a chord inside a word is
// taken out of it: "szö[F]vege" is "szövege"), no labels, no directives.
// What the search looks through (search.ts).
export function plainLyrics(source: string): string[] {
  return parseChordPro(source)
    .lines.flatMap((line) =>
      line.type === 'lyrics'
        ? [
            line.segments
              .map((s) => s.text)
              .join('')
              .replace(/\s+/g, ' ')
              .trim(),
          ]
        : [],
    )
    .filter(Boolean);
}
