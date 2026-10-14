// Shows a Könyvtár book's play-along tracks as the server sees them, and
// the track-to-page links it would propose from "Track N" in the text:
//   node scripts/libraryAudioCheck.mjs <part of the book's title or file name>
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import { LibraryBook } from '../src/models/libraryModels.js';
import { bookTracks, proposeAudioLinks } from '../src/utils/libraryAudio.js';

const [part = ''] = process.argv.slice(2);
await mongoose.connect(config.db.uri);
try {
  const books = await LibraryBook.find().lean();
  const book = books.find((b) =>
    `${b.title} ${b.filename}`.toLowerCase().includes(part.toLowerCase()),
  );
  if (!book) {
    console.log(`No book matches "${part}". Books: ${books.map((b) => b.filename).join(', ')}`);
  } else {
    const tracks = bookTracks(book);
    console.log(`${book.filename}: ${book.pages} pages, ${tracks.length} tracks`);
    for (const t of tracks.slice(0, 5)) console.log(`  #${t.number} ${t.title}`);
    const links = await proposeAudioLinks(book);
    console.log(`Proposed links: ${links.length}`);
    for (const l of links) {
      const t = tracks.find((x) => x.file === l.file);
      console.log(
        `  PDF page ${l.page} (printed ${l.page + book.pageOffset}): #${t.number} ${t.title}`,
      );
    }
  }
} finally {
  await mongoose.disconnect();
}
