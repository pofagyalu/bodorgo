// Lists the songs added most lately - title, address, when, whose, and
// whether they are the book's own - to see what a save really wrote.
// Reads only. Run from server/:
//   node scripts/newestSongs.mjs                        (the dev database - .env)
//   node scripts/newestSongs.mjs --env=S:/bodorgo/.env  (live)
import fs from 'fs';
import mongoose from 'mongoose';

const envFile = process.argv.find((a) => a.startsWith('--env='))?.slice('--env='.length) ?? '.env';
const line = fs
  .readFileSync(envFile, 'utf8')
  .split(/\r?\n/)
  .find((l) => l.startsWith('DB_URI='));
if (!line) throw new Error(`No DB_URI in ${envFile}`);

await mongoose.connect(
  line
    .slice('DB_URI='.length)
    .trim()
    .replace(/^["']|["']$/g, ''),
);
const db = mongoose.connection.db;
console.log(`database: ${db.databaseName}`);
const songs = await db
  .collection('songs')
  .find({}, { projection: { title: 1, slug: 1, createdAt: 1, updatedAt: 1, owner: 1, inBook: 1 } })
  .sort({ createdAt: -1 })
  .limit(4)
  .toArray();
for (const song of songs) {
  const owner = song.owner
    ? ((await db.collection('users').findOne({ _id: song.owner }, { projection: { name: 1 } }))
        ?.name ?? '?')
    : '-';
  console.log(
    `${song.createdAt?.toISOString() ?? '?'}  ${song.slug}  "${song.title}"  owner: ${owner}  inBook: ${song.inBook}`,
  );
}
await mongoose.disconnect();
