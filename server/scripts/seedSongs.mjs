// Puts the two sample songs of DALOSKONYV_SPEC.md into the Daloskönyv of
// the database DB_URI points at - for trying the page before the real
// songs arrive. A song already there (by its slug) is left alone.
//   node scripts/seedSongs.mjs
import 'dotenv/config';
import mongoose from 'mongoose';
import Song from '../src/models/songModel.js';

const SONGS = [
  {
    title: 'Próbadal',
    artist: 'Bódorgók',
    chordpro: `[C]Elindultunk [G]reggel, [Am]hátizsák a [F]hátunkon,
[C]Bódorgunk a [G]dombon, [F]nem várunk a [C]napra.

{start_of_chorus}
[F]Hej, bódor[G]gók, [C]menjünk [Am]tovább,
[F]Hegyen-völgyön [G]át, [C]
{end_of_chorus}
{comment: Refrén 2x}

[C]Este tábor[G]tűznél [Am]szól a régi [F]nóta,
[C]Gitár peng a [G]csendben, [F]száll a füst az [C]égre.

{start_of_chorus}
[F]Hej, bódor[G]gók, [C]menjünk [Am]tovább,
[F]Hegyen-völgyön [G]át, [C]
{end_of_chorus}

[C]Hajnalban a [G]harmat [Am]ül a sátor [F]ponyván,
[C]Főzzük már a [G]kávét, [F]indulunk [C]megint.

{start_of_chorus}
[F]Hej, bódor[G]gók, [C]menjünk [Am]tovább,
[F]Hegyen-völgyön [G]át, [C]
{end_of_chorus}

[C]Patak mellett [G]pihenünk, [Am]lógatjuk a [F]lábunk,
[C]Senki nem si[G]et sehova, [F]ráérünk [C]holnap.

{start_of_chorus}
[F]Hej, bódor[G]gók, [C]menjünk [Am]tovább,
[F]Hegyen-völgyön [G]át, [C]
{end_of_chorus}
{comment: Refrén 2x, lassítva}`,
  },
  {
    title: 'Akkordteszt',
    artist: '',
    chordpro: `[Am7]Négy [Dm7]akkord [G7]egy [Cmaj7]sorban
[H]Magyar [Hm]jelölés [B]teszt
[G/B]Basszus[C]váltás`,
  },
];

await mongoose.connect(process.env.DB_URI);
console.log(`Database: ${mongoose.connection.name}`);
for (const song of SONGS) {
  const slug = await Song.freeSlug(song.title);
  const base = slug.replace(/-\d+$/, '');
  if (await Song.exists({ slug: base })) {
    console.log(`  already there: ${song.title}`);
    continue;
  }
  await Song.create({ ...song, slug });
  console.log(`  added: ${song.title}`);
}
await mongoose.disconnect();
