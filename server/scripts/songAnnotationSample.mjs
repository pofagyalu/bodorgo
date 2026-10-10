// Draws one made-up song with ChordPro annotations ("[*/]" - the chord
// before once more) as a PDF, to look at them over the words:
//   node scripts/songAnnotationSample.mjs <out.pdf>
import fs from 'fs';
import { renderSongPdf } from '../src/songs/songBook.js';

const [output = 'song-annotation-sample.pdf'] = process.argv.slice(2);
const pdf = await renderSongPdf(
  {
    title: 'Próbadal',
    artist: 'Valaki',
    slug: 'probadal',
    key: '',
    chordpro: [
      '[am]Első sor szö[*/]vege [G]itt [*/]van',
      '[C]Második [*Coda]sor [Intro]címkével [F7]is',
      '',
      '{screen}',
      '[am]Csak kép[*/]ernyőn',
    ].join('\n'),
  },
  { diagrams: 'guitar' },
);
fs.writeFileSync(output, pdf);
