// Copies the Daloskönyv's songs from the dev database to the live one -
// the songs imported and corrected on dev. Matched by the song's address
// (slug): a song the live database doesn't have yet is added; one it has
// is left alone, unless --update says to bring its title, artist and
// lyrics over from dev too. Nothing is ever deleted on live.
// Run from server/:
//   node scripts/copySongsToLive.mjs                 (dry run - shows what it would do)
//   node scripts/copySongsToLive.mjs --go            (adds the new ones)
//   node scripts/copySongsToLive.mjs --update --go   (and overwrites the ones already there)
//   node scripts/copySongsToLive.mjs --skip=a-slug,another --go   (all but these)
import fs from 'fs';
import mongoose from 'mongoose';

const uriFrom = (envFile) => {
  const line = fs
    .readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('DB_URI='));
  if (!line) throw new Error(`No DB_URI in ${envFile}`);
  return line.slice('DB_URI='.length).trim();
};

const go = process.argv.includes('--go');
const update = process.argv.includes('--update');
const skip = new Set(
  (process.argv.find((a) => a.startsWith('--skip='))?.slice('--skip='.length) ?? '')
    .split(',')
    .filter(Boolean),
);

const dev = await mongoose.createConnection(uriFrom('.env')).asPromise();
const live = await mongoose.createConnection(uriFrom('S:/bodorgo/.env')).asPromise();
console.log(`dev: ${dev.name}  ->  live: ${live.name}${go ? '' : '   (dry run)'}`);
if (dev.name === live.name) throw new Error('Both are the same database');

const songs = await dev.collection('songs').find().sort({ title: 1 }).toArray();
let added = 0;
let updated = 0;
let kept = 0;
let skipped = 0;
for (const song of songs) {
  if (skip.has(song.slug)) {
    skipped += 1;
    continue;
  }
  const there = await live
    .collection('songs')
    .findOne({ slug: song.slug }, { projection: { _id: 1 } });
  const fields = {
    title: song.title,
    artist: song.artist ?? '',
    chordpro: song.chordpro ?? '',
    tags: song.tags ?? [],
  };
  if (!there) {
    if (go) {
      await live.collection('songs').insertOne({
        ...fields,
        slug: song.slug,
        updatedBy: null,
        createdAt: song.createdAt ?? new Date(),
        updatedAt: new Date(),
      });
    }
    added += 1;
  } else if (update) {
    if (go) {
      await live
        .collection('songs')
        .updateOne({ _id: there._id }, { $set: { ...fields, updatedAt: new Date() } });
    }
    updated += 1;
  } else {
    kept += 1;
  }
}
console.log(
  `${songs.length} songs on dev: ${go ? 'added' : 'would add'} ${added}, ${go ? 'updated' : 'would update'} ${updated}, left alone ${kept}, skipped ${skipped}`,
);
console.log(`live now has ${await live.collection('songs').countDocuments()} songs`);
await dev.close();
await live.close();
