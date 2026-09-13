// Keeps the local tour images folder and the NAS's in sync. There's no
// automated deploy step for these (server/sync.js only copies the built
// server.js bundle to S:\bodorgo, never public/ - and public/ isn't even
// git-tracked, see server/.gitignore), so it's easy for a file uploaded to
// just one side to quietly never make it to the other.
//
// Usage (run from server/):
//   node scripts/syncImages.js
//
// Copies whatever's missing on either side, in both directions - upload a
// new image to just the NAS, or just your local folder, then run this once
// to catch the other side up. Never deletes or overwrites anything.

import fs from 'fs';
import path from 'path';

const LOCAL_DIR = path.resolve('public/img/tours');
const NAS_DIR = 'S:/bodorgo/public/img/tours';

function listImages(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.(webp|jpe?g|png)$/i.test(f));
}

const localFiles = new Set(listImages(LOCAL_DIR));
const nasFiles = new Set(listImages(NAS_DIR));

let copied = 0;

for (const file of nasFiles) {
  if (!localFiles.has(file)) {
    fs.copyFileSync(path.join(NAS_DIR, file), path.join(LOCAL_DIR, file));
    console.log(`NAS -> local: ${file}`);
    copied++;
  }
}

for (const file of localFiles) {
  if (!nasFiles.has(file)) {
    fs.copyFileSync(path.join(LOCAL_DIR, file), path.join(NAS_DIR, file));
    console.log(`local -> NAS: ${file}`);
    copied++;
  }
}

console.log(copied === 0 ? 'Already in sync.' : `Done - ${copied} file(s) copied.`);
