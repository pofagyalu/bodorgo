const fs = require('fs');
const path = require('path');

const source = path.resolve('dist/client/browser/hu');
const dest = 'W:/bodorgo';

// Clear out the previous deploy's content-hashed bundles and asset folders
// first, so old builds don't accumulate as orphaned files - but keep
// server-config files (like .htaccess) that aren't part of the build output.
const KEEP = new Set(['.htaccess']);
for (const entry of fs.readdirSync(dest)) {
  if (KEEP.has(entry)) continue;
  fs.rmSync(path.join(dest, entry), { recursive: true, force: true });
}

fs.cpSync(source, dest, { recursive: true, force: true });
console.log('✓ Synced dist/client/browser/hu → W:/bodorgo');
