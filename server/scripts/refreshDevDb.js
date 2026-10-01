// Refreshes the local development database (bodorgo-dev) from production
// (bodorgo): every collection's documents are replaced with production's.
//
//   node scripts/refreshDevDb.js          - only shows what would happen
//   node scripts/refreshDevDb.js --go     - does it
//
// Production is only read (as the live server's own user, from the live
// .env on the NAS share); the development database is written as its own
// user (server/.env) - which can't touch production.
//
// Left out, on purpose:
//  - sessions: yours stay, so you remain logged in locally;
//  - push subscriptions: none are copied (and dev's are cleared) - a local
//    test must never push to members' phones;
//  - the Barion wallets in the club settings (payees, API keys): dev keeps
//    its own, so a local payment can't go to the live shop.
//
// Uploaded files (documents/, chat-images/) are on each machine's disk, not
// in the database - they are not copied by this.
import fs from 'fs';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const LIVE_ENV = 'S:/bodorgo/.env';
const SKIP = new Set(['sessions']);
const EMPTY_IN_DEV = new Set(['pushsubscriptions']);
const BATCH = 500;

const go = process.argv.includes('--go');

dotenv.config({ quiet: true });
const devUri = process.env.DB_URI;
const prodUri = dotenv.parse(fs.readFileSync(LIVE_ENV)).DB_URI;
if (!devUri || !prodUri) throw new Error('DB_URI missing from server/.env or the live .env');

const dbName = (uri) => new URL(uri).pathname.slice(1);
if (dbName(devUri) !== 'bodorgo-dev' || dbName(prodUri) !== 'bodorgo') {
  throw new Error(`Unexpected databases: dev "${dbName(devUri)}", production "${dbName(prodUri)}"`);
}

const prod = await mongoose.createConnection(prodUri).asPromise();
const dev = await mongoose.createConnection(devUri).asPromise();

try {
  const names = async (conn) =>
    (await conn.db.listCollections().toArray())
      .filter((c) => c.type === 'collection' && !c.name.startsWith('system.'))
      .map((c) => c.name)
      .sort();
  const prodNames = await names(prod);
  const devNames = await names(dev);

  // Dev's own Barion wallets, to put back after the club settings arrive.
  const devSettings = await dev.db.collection('clubsettings').findOne({ key: 'club' });

  console.log(go ? 'Refreshing bodorgo-dev from bodorgo:\n' : 'DRY RUN - nothing is changed:\n');
  for (const name of prodNames) {
    const from = prod.db.collection(name);
    const to = dev.db.collection(name);
    const [inProd, inDev] = await Promise.all([from.countDocuments(), to.countDocuments()]);
    const note = SKIP.has(name)
      ? 'left as it is'
      : EMPTY_IN_DEV.has(name)
        ? 'emptied (not copied)'
        : 'replaced';
    console.log(
      `  ${name.padEnd(22)} production ${String(inProd).padStart(6)}   dev ${String(inDev).padStart(6)}   ${note}`,
    );
    if (!go || SKIP.has(name)) continue;

    await to.deleteMany({});
    if (EMPTY_IN_DEV.has(name)) continue;
    let batch = [];
    for await (const doc of from.find()) {
      batch.push(doc);
      if (batch.length === BATCH) {
        await to.insertMany(batch, { ordered: false });
        batch = [];
      }
    }
    if (batch.length) await to.insertMany(batch, { ordered: false });
  }

  for (const name of devNames.filter((n) => !prodNames.includes(n))) {
    console.log(`  ${name.padEnd(22)} only in dev - left as it is`);
  }

  if (go && devSettings?.barion !== undefined) {
    await dev.db
      .collection('clubsettings')
      .updateOne({ key: 'club' }, { $set: { barion: devSettings.barion } });
    console.log('\n  Club settings: dev keeps its own Barion wallets.');
  }
  console.log(go ? '\nDone.' : '\nRun again with --go to do it.');
} finally {
  await Promise.all([prod.close(), dev.close()]);
}
