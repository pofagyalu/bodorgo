// A one-song Daloskönyv PDF with chords that have numbers in them - to
// look at how the indexes are set (F⁷, Gsus², D⁷/F#).
//   node scripts/songBookIndexSample.mjs <out.pdf> [guitar|ukulele]
import fs from 'fs';
import { renderSongBook } from '../src/songs/songBook.js';

const [out = 'index-sample.pdf', diagrams = 'guitar'] = process.argv.slice(2);
const chordpro = `[Intro] [am7] [D7/F#] [Gsus2] [G]

[F7]Tavaszi szél [Gsus2]vizet áraszt, [am7]virágom, vi[Cmaj7]rágom,
[D7/F#]Minden madár [G7sus4]társat választ, [Cadd9]virágom, vi[C]rágom. [2x]

{start_of_chorus}
[E7]Hát én immár [A7]kit válasszak, [dm7]virágom, vi[G7]rágom?
{end_of_chorus}`;
const pdf = await renderSongBook([{ title: 'Indexpróba', artist: 'F7, Gsus2', chordpro }], {
  diagrams,
});
fs.writeFileSync(out, pdf);
console.log(`→ ${out}`);
