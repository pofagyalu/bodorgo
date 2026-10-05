// Copies the tours' 360° panorama link and title (panoramaUrl,
// panoramaTitle) from the dev database to the live one, matched by the tour
// number - only those two fields, nothing else.
// Run from server/:
//   node scripts/copyPanoramaToLive.mjs 30 32        (dry run - shows what it would do)
//   node scripts/copyPanoramaToLive.mjs 30 32 --go   (writes)
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
const orders = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);
if (!orders.length) throw new Error('Which tours? e.g. 30 32');

const dev = await mongoose.createConnection(uriFrom('.env')).asPromise();
const live = await mongoose.createConnection(uriFrom('S:/bodorgo/.env')).asPromise();
console.log(`dev: ${dev.name}  ->  live: ${live.name}${go ? '' : '   (dry run)'}`);
if (dev.name === live.name) throw new Error('Both are the same database');

const fields = { order: 1, title: 1, panoramaUrl: 1, panoramaTitle: 1 };
for (const order of orders) {
  const from = await dev.collection('tours').findOne({ order }, { projection: fields });
  const to = await live.collection('tours').findOne({ order }, { projection: fields });
  console.log(`\n${order}. dev:  ${from?.title} | ${from?.panoramaUrl ?? '-'} | ${from?.panoramaTitle ?? '-'}`);
  console.log(`${order}. live: ${to?.title} | ${to?.panoramaUrl ?? '-'} | ${to?.panoramaTitle ?? '-'}`);
  if (!from?.panoramaUrl || !to) {
    console.log('   skipped (no link on dev, or no such tour on live)');
    continue;
  }
  if (!/^https?:\/\/\S+$/i.test(from.panoramaUrl)) {
    console.log('   skipped (not an http(s) link)');
    continue;
  }
  if (go) {
    const res = await live
      .collection('tours')
      .updateOne(
        { _id: to._id },
        { $set: { panoramaUrl: from.panoramaUrl, panoramaTitle: from.panoramaTitle ?? '' } },
      );
    console.log(`   written (modified ${res.modifiedCount})`);
  } else {
    console.log('   would write');
  }
}
await dev.close();
await live.close();
