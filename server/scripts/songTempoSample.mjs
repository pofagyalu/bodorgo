// Draws one made-up song with a tempo as a PDF, to look at the marker
// after its key:
//   node scripts/songTempoSample.mjs <out.pdf>
import fs from 'fs';
import { renderSongPdf } from '../src/songs/songBook.js';

const [output = 'song-tempo-sample.pdf'] = process.argv.slice(2);
const pdf = await renderSongPdf(
  {
    title: 'Próbadal',
    artist: 'Valaki',
    slug: 'probadal',
    key: '',
    tempo: 96,
    chordpro: '[am]La la la [F]la la\n[C]La la [G]la',
  },
  { diagrams: 'guitar' },
);
fs.writeFileSync(output, pdf);
