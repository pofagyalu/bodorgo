import fs from 'fs';
import path from 'path';
import { LIBRARY_DIR } from './dataDirs.js';
import { LibraryPage } from '../models/libraryModels.js';

// The Könyvtár's play-along tracks: a book's audio files are in a folder
// beside its PDF with the same name, without ".pdf" ("Daily Studies.pdf" ->
// "Daily Studies/"). Nothing about them is stored but which page each is
// linked to (the book's audioLinks) - the folder itself is the list, read
// when asked: put a file there and the book has it.

const AUDIO_TYPES = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
};

export const audioType = (file) => AUDIO_TYPES[path.extname(file).toLowerCase()];

export const audioDir = (book) =>
  path.join(LIBRARY_DIR, book.shelf, path.parse(book.filename).name);

// "05 5 Example 2.7 - C Major Scale.mp3" -> number 5 (the first number of
// the name - a CD's track number), title "Example 2.7 - C Major Scale"
// (the numbers in front taken off). "Track_07.mp3" -> 7. A name without
// any number has none.
export function parseTrackName(file) {
  const name = path.parse(file).name.replace(/_/g, ' ');
  const lead = /^\s*(\d{1,3})\b/.exec(name) ?? /\b(?:track|cd)\s*(\d{1,3})\b/i.exec(name);
  const title = name.replace(/^[\s\d.\-–_)]+(?=\S)/, '').trim() || name.trim();
  return { number: lead ? Number(lead[1]) : null, title };
}

// The book's tracks, in the order of their names (numbers by their value:
// 2 before 10). Empty when the book has no audio folder.
export function bookTracks(book) {
  let entries;
  try {
    entries = fs.readdirSync(audioDir(book), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && audioType(e.name) && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'hu', { numeric: true }))
    .map((file) => ({ file, ...parseTrackName(file) }));
}

// The file of one of the book's tracks - null for a name that isn't one
// (nothing outside the folder can be asked for this way).
export function trackPath(book, file) {
  return bookTracks(book).some((t) => t.file === file) ? path.join(audioDir(book), file) : null;
}

// Links guessed from the book's text: a page that says "Track 8" (or
// "CD 8") gets the track numbered 8. Only a proposal - the owner corrects
// it before it is saved.
export async function proposeAudioLinks(book) {
  const byNumber = new Map();
  for (const track of bookTracks(book)) {
    if (track.number !== null && !byNumber.has(track.number)) byNumber.set(track.number, track);
  }
  if (!byNumber.size) return [];
  const pages = await LibraryPage.find({ book: book._id }).sort({ page: 1 }).lean();
  const links = [];
  const seen = new Set();
  for (const page of pages) {
    for (const match of page.text.matchAll(/\b(?:track|cd)\s*#?\s*(\d{1,3})\b/gi)) {
      const track = byNumber.get(Number(match[1]));
      const key = `${track?.file}|${page.page}`;
      if (track && !seen.has(key)) {
        seen.add(key);
        links.push({ file: track.file, page: page.page });
      }
    }
  }
  return links;
}
