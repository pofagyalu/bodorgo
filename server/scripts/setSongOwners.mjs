// Song ownership, for the songs from before it: every song without an
// owner gets the book's keeper - the role manager, INITIAL_ADMIN_USER in
// the .env read - as its owner, and is marked as the book's own
// (inBook: true). A song that has an owner already is left alone. Nothing
// else of a song is touched (updatedAt neither - the book's date stays).
// Run from server/:
//   node scripts/setSongOwners.mjs                      (dry run on the dev database - .env)
//   node scripts/setSongOwners.mjs --go                 (does it there)
//   node scripts/setSongOwners.mjs --env=S:/bodorgo/.env        (dry run on live)
//   node scripts/setSongOwners.mjs --env=S:/bodorgo/.env --go   (does it on live)
import fs from 'fs';
import mongoose from 'mongoose';

const go = process.argv.includes('--go');
const envFile = process.argv.find((a) => a.startsWith('--env='))?.slice('--env='.length) ?? '.env';

const fromEnv = (name) => {
  const line = fs
    .readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`));
  if (!line) throw new Error(`No ${name} in ${envFile}`);
  return line
    .slice(name.length + 1)
    .trim()
    .replace(/^["']|["']$/g, '');
};

const email = fromEnv('INITIAL_ADMIN_USER').toLowerCase();
await mongoose.connect(fromEnv('DB_URI'));
const db = mongoose.connection.db;
console.log(`database: ${db.databaseName} (${envFile})`);

const keeper = await db.collection('users').findOne({ email });
if (!keeper) throw new Error(`No user with the e-mail ${email}`);
console.log(`keeper: ${keeper.name} <${keeper.email}>`);

const songs = db.collection('songs');
const without = { $or: [{ owner: null }, { owner: { $exists: false } }] };
const [all, missing] = await Promise.all([songs.countDocuments(), songs.countDocuments(without)]);
console.log(`songs: ${all}, without an owner: ${missing}`);

if (!go) {
  console.log('dry run - nothing changed (add --go)');
} else {
  const result = await songs.updateMany(without, { $set: { owner: keeper._id, inBook: true } });
  console.log(`changed: ${result.modifiedCount}`);
  const [left, inBook] = await Promise.all([
    songs.countDocuments(without),
    songs.countDocuments({ inBook: true }),
  ]);
  console.log(`now without an owner: ${left}, in the book: ${inBook}`);
}
await mongoose.disconnect();
