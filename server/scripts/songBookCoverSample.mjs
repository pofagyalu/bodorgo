// Writes the songbook's cover alone as a PDF, to look at it (no database):
//   node scripts/songBookCoverSample.mjs <out.pdf>
// Then: node scripts/pdfToPng.mjs <out.pdf> <out.png>
import fs from 'fs';
import { renderSongBookCover } from '../src/songs/songBook.js';

const [output] = process.argv.slice(2);
const cover = await renderSongBookCover({ count: 123, diagrams: 'guitar' });
fs.writeFileSync(output, cover);
console.log('written', output, cover.length, 'bytes');
