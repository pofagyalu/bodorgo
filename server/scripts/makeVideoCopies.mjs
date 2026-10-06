// Makes the small copy (utils/videoCopies.js) of every video that has none
// yet - the tours' and Média's alike - one after the other, with the same
// settings and into the same place as the admin's "Tömörítés"
// button. For the first round, on a machine stronger than the NAS:
//
//   node --env-file=.env scripts/makeVideoCopies.mjs          make them
//   node --env-file=.env scripts/makeVideoCopies.mjs --list   only say which
//
// Safe to stop (Ctrl+C) and start again: what is done is skipped. Don't
// press the button in the app while it runs - that would be a second
// conversion at the same time.
import path from 'path';
import { mediaVideoFiles } from '../src/controllers/mediaVideoController.js';
import { tourVideoFiles } from '../src/utils/tourVideos.js';
import { requestSmallCopy, smallCopyJobs, smallCopyState } from '../src/utils/videoCopies.js';

const nameOf = (v) => `${v.area}/${path.relative(v.root, v.fullPath).split(path.sep).join('/')}`;
const all = [...tourVideoFiles(), ...mediaVideoFiles()];
const missing = all.filter((v) => smallCopyState(v) !== 'ready');

console.log(`${all.length} videó, ebből ${missing.length} tömörített változat nélkül.`);
for (const v of missing) console.log(`  ${nameOf(v)}`);
if (process.argv.includes('--list') || !missing.length) process.exit(0);

// Ctrl+C also stops the conversion that is going.
process.on('SIGINT', () => process.exit(130));

for (const v of missing) requestSmallCopy(v, nameOf(v));

const started = Date.now();
let lastLine = '';
const timer = setInterval(() => {
  const jobs = smallCopyJobs();
  const done = jobs.filter((j) => j.state === 'ready').length;
  const failed = jobs.filter((j) => j.state === 'failed');
  const now = jobs.find((j) => j.state === 'converting');
  if (now) {
    const line = `[${done + failed.length + 1}/${jobs.length}] ${now.ref}: ${now.percent ?? 0}%`;
    if (line !== lastLine) console.log(line);
    lastLine = line;
    return;
  }
  if (jobs.some((j) => j.state === 'queued')) return;
  clearInterval(timer);
  const minutes = Math.round((Date.now() - started) / 60000);
  console.log(`Kész: ${done} elkészült, ${failed.length} nem sikerült (${minutes} perc).`);
  for (const j of failed) console.log(`  NEM SIKERÜLT ${j.ref}: ${j.error}`);
  process.exit(failed.length ? 1 : 0);
}, 5000);
