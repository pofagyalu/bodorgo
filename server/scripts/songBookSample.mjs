// Writes the Daloskönyv PDF of the database DB_URI points at into a file,
// to look at it (its first page as a PNG: scripts/pdfToPng.mjs).
//   node scripts/songBookSample.mjs <out.pdf> [guitar|ukulele|none] [A4|A5]
import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';
import Song from '../src/models/songModel.js';
import { renderSongBook } from '../src/songs/songBook.js';

const [out = 'daloskonyv.pdf', diagrams = 'none', size = 'A4'] = process.argv.slice(2);
await mongoose.connect(process.env.DB_URI);
const songs = await Song.find().collation({ locale: 'hu' }).sort('title').lean();
const lastAdded = new Date(Math.max(...songs.map((s) => +s.createdAt)));
const started = Date.now();
const pdf = await renderSongBook(songs, {
  diagrams: diagrams === 'none' ? null : diagrams,
  size,
  lastAdded,
});
fs.writeFileSync(out, pdf);
console.log(
  `${songs.length} songs → ${out} (${Math.round(pdf.length / 1024)} kB, ${Date.now() - started} ms)`,
);
await mongoose.disconnect();
