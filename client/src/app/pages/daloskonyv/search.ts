// Finding songs in the songbook: by title and artist, and by their words.

// "Eső után" → "eso utan": the search doesn't mind accents or capitals.
// Letter for letter - the folded text is as long as the original, so a
// place found in one is the same place in the other.
export const fold = (text: string) =>
  [...text]
    .map((letter) => {
      const plain = letter.normalize('NFD').replace(/\p{Diacritic}/gu, '');
      // One letter in, one letter out - whatever it folds to.
      return plain.length === 1 ? plain.toLowerCase() : letter.toLowerCase();
    })
    .join('');

// The words of a search have to be this long before the lyrics are looked
// through: one or two letters are in every song.
export const LYRICS_FROM = 3;

// A line of a song's words where the search was found: what stands before
// the found part, the part itself, and the rest.
export interface FoundLine {
  before: string;
  match: string;
  after: string;
}

export interface Found<Song> {
  song: Song;
  // Found in the words (not in the title or the artist): the first line
  // that has it.
  line: FoundLine | null;
}

// The songs a search finds, in the book's order: first the ones with it in
// their title or artist, then the ones with it only in their words - each
// of those with the line it was found in. An empty search: every song.
// lyrics: each song's words line by line, by the song's id (undefined
// until they have arrived - the titles are searched all the same).
export function searchSongs<Song extends { _id: string; title: string; artist: string }>(
  songs: Song[],
  search: string,
  lyrics?: ReadonlyMap<string, string[]>,
): Found<Song>[] {
  const q = fold(search.trim());
  if (!q) return songs.map((song) => ({ song, line: null }));

  const byName: Found<Song>[] = [];
  const byWords: Found<Song>[] = [];
  for (const song of songs) {
    if (fold(`${song.title} ${song.artist}`).includes(q)) {
      byName.push({ song, line: null });
      continue;
    }
    if (q.length < LYRICS_FROM) continue;
    for (const text of lyrics?.get(song._id) ?? []) {
      const at = fold(text).indexOf(q);
      if (at < 0) continue;
      byWords.push({
        song,
        line: {
          before: text.slice(0, at),
          match: text.slice(at, at + q.length),
          after: text.slice(at + q.length),
        },
      });
      break;
    }
  }
  return [...byName, ...byWords];
}
