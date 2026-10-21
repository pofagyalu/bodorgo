// Since a Média video with nothing set is for the admins alone
// (mediaVideoTitleModel.js's access), this gives every video already there
// its access as it was: 'chosen' where viewers were picked, 'all' for the
// rest - so nothing members saw disappears. The ones named with --admins
// become the admins' alone. Videos are found through this folder's own
// .env (MEDIA_ROOT, e.g. Y:/sorozatok); the database is the DB_URI of the
// .env given (this folder's by default, live's is S:/bodorgo/.env). Run it
// once per database, before the server that reads access goes live there.
//
// Usage:
//   node scripts/fillVideoAccess.mjs [path/to/.env] [--admins "<category>/<path>"]...           (dry run)
//   node scripts/fillVideoAccess.mjs [path/to/.env] [--admins "<category>/<path>"]... --apply
import 'dotenv/config';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import MediaVideoTitle from '../src/models/mediaVideoTitleModel.js';
import { mediaVideoPaths } from '../src/controllers/mediaVideoController.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const adminsOnly = new Set(args.filter((a, i) => args[i - 1] === '--admins'));
const envFile = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--admins') ?? '.env';
const { DB_URI } = dotenv.config({ path: envFile, quiet: true, processEnv: {} }).parsed ?? {};
if (!DB_URI) throw new Error(`No DB_URI in ${envFile}`);

await mongoose.connect(DB_URI);
console.log('Database:', mongoose.connection.db.databaseName);

const videos = mediaVideoPaths().map((v) => ({
  category: v.area.replace(/^media:/, ''),
  path: v.path,
}));
const unknown = [...adminsOnly].filter(
  (ref) => !videos.some((v) => `${v.category}/${v.path}` === ref),
);
if (unknown.length) throw new Error(`No such video: ${unknown.join(', ')}`);

let changed = 0;
for (const video of videos) {
  const ref = `${video.category}/${video.path}`;
  const own = await MediaVideoTitle.findOne(video).lean();
  const access = adminsOnly.has(ref)
    ? 'admins'
    : (own?.access ?? (own?.viewers?.length ? 'chosen' : 'all'));
  if (own?.access === access) continue;
  console.log(`${apply ? 'Setting' : '[dry run] Would set'} ${access}: ${ref}`);
  if (apply) {
    await MediaVideoTitle.updateOne(
      video,
      { $set: { access, ...(access === 'chosen' ? {} : { viewers: [] }) } },
      { upsert: true },
    );
  }
  changed++;
}

console.log(`\n${videos.length} video(s), ${changed} ${apply ? 'set' : 'to set'}.`);
if (!apply && changed) console.log('This was a dry run - re-run with --apply to write them.');
await mongoose.disconnect();
process.exit(0);
