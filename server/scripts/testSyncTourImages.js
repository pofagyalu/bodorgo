// Verifies diffTourImages (syncTourImages.js's pure add/remove diff logic)
// against a handful of made-up scenarios - no DB/filesystem/sharp
// involved, so this is safe to run any time and doesn't touch real tour
// photos. Covers the gap closed per the admin's request: a photo deleted
// from the folder should be detected for removal, not just new ones added.
//
// Usage:
//   node scripts/testSyncTourImages.js

import { diffTourImages } from './syncTourImages.js';

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

// --- Only new files, nothing removed ---
{
  const filesOnDisk = ['a.jpg', 'b.jpg', 'c.jpg'];
  const recorded = [{ filename: 'a.jpg' }, { filename: 'b.jpg' }];
  const { newFilenames, removedImages } = diffTourImages(filesOnDisk, recorded);
  check('detects the one new file', newFilenames.length === 1 && newFilenames[0] === 'c.jpg');
  check('nothing flagged as removed', removedImages.length === 0);
}

// --- Only a deletion, nothing new ---
{
  const filesOnDisk = ['a.jpg'];
  const recorded = [{ filename: 'a.jpg' }, { filename: 'b.jpg' }];
  const { newFilenames, removedImages } = diffTourImages(filesOnDisk, recorded);
  check('no new files', newFilenames.length === 0);
  check('detects the one deleted file for pruning', removedImages.length === 1 && removedImages[0].filename === 'b.jpg');
}

// --- Both at once (one added, one deleted) ---
{
  const filesOnDisk = ['a.jpg', 'c.jpg'];
  const recorded = [{ filename: 'a.jpg' }, { filename: 'b.jpg' }];
  const { newFilenames, removedImages } = diffTourImages(filesOnDisk, recorded);
  check('detects the new file alongside a removal', newFilenames.length === 1 && newFilenames[0] === 'c.jpg');
  check('detects the removed file alongside an addition', removedImages.length === 1 && removedImages[0].filename === 'b.jpg');
}

// --- Nothing changed ---
{
  const filesOnDisk = ['a.jpg', 'b.jpg'];
  const recorded = [{ filename: 'a.jpg' }, { filename: 'b.jpg' }];
  const { newFilenames, removedImages } = diffTourImages(filesOnDisk, recorded);
  check('no new files when nothing changed', newFilenames.length === 0);
  check('no removed files when nothing changed', removedImages.length === 0);
}

// --- Empty folder (e.g. briefly unreachable) still reports every
// recorded image as "removed" - diffTourImages itself has no special
// case for this; the real script's own fs.existsSync guard (checked
// before ever reading the folder) is what actually protects against
// treating an unreachable PHOTOS_ROOT as "delete everything".
{
  const filesOnDisk = [];
  const recorded = [{ filename: 'a.jpg' }, { filename: 'b.jpg' }];
  const { newFilenames, removedImages } = diffTourImages(filesOnDisk, recorded);
  check('an empty listing has no new files', newFilenames.length === 0);
  check('an empty listing flags every recorded image as removed', removedImages.length === 2);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
