// Draws one made-up song with its own chord shapes ({define}, with and
// without fingers) as a PDF, to look at the diagrams:
//   node scripts/songDefineSample.mjs <out.pdf> [guitar|ukulele]
import fs from 'fs';
import { renderSongPdf } from '../src/songs/songBook.js';

const [output = 'song-define-sample.pdf', diagrams = 'guitar'] = process.argv.slice(2);
const pdf = await renderSongPdf(
  {
    title: 'Próbadal',
    artist: 'Valaki',
    slug: 'probadal',
    key: '',
    chordpro: [
      '{define: D7 base-fret 3 frets x 3 2 3 1 x fingers 0 3 2 4 1 0}',
      '{define: B base-fret 1 frets 1 1 3 3 3 1 fingers 1 1 2 3 4 1}',
      '{define: C7 base-fret 1 frets x 3 2 3 1 0}',
      '{define: G frets 3 2 0 0 3 3 fingers 2 1 0 0 3 4}',
      '{define: C frets 0 0 0 3 fingers 0 0 0 3}',
      '',
      '[am]La la la [D7]la la [B]la',
      '[C7]La la [G]la [F]la [C]la',
    ].join('\n'),
  },
  { diagrams },
);
fs.writeFileSync(output, pdf);
