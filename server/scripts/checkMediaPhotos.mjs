// Média → Fotók: what each database has recorded for a category, beside
// what is on the disk now - a photo listed but no longer there (renamed,
// replaced) shows as a broken image until "Új média felfedezése" is run on
// that side. Reads only.
// Run from server/:
//   node scripts/checkMediaPhotos.mjs logók
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';

const valueFrom = (envFile, key) =>
  fs
    .readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${key}=`))
    ?.slice(key.length + 1)
    .trim();

const category = process.argv[2];
if (!category) throw new Error('Which category? e.g. logók');

for (const [name, envFile] of [
  ['dev', '.env'],
  ['live', 'S:/bodorgo/.env'],
]) {
  const db = await mongoose.createConnection(valueFrom(envFile, 'DB_URI')).asPromise();
  const recorded = await db
    .collection('mediaphotos')
    .find({ category }, { projection: { filename: 1, addedAt: 1 } })
    .sort({ filename: 1 })
    .toArray();
  // The folder as this machine sees it (the live server may have it under
  // another path - then only the names are compared).
  const folder = path.join(valueFrom('.env', 'MEDIA_PHOTOS_ROOT'), category);
  const onDisk = new Set(fs.readdirSync(folder));
  console.log(`\n${name} (${db.name}): ${recorded.length} recorded`);
  for (const p of recorded) {
    console.log(
      `  ${onDisk.has(p.filename) ? 'ok     ' : 'MISSING'} ${p.filename}  (added ${p.addedAt?.toISOString().slice(0, 10) ?? '-'})`,
    );
  }
  const names = new Set(recorded.map((p) => p.filename));
  for (const f of onDisk) {
    if (/\.(jpe?g|png|webp|heic)$/i.test(f) && !names.has(f)) console.log(`  NOT RECORDED ${f}`);
  }
  await db.close();
}
