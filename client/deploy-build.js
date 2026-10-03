const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync, spawnSync } = require('child_process');

// The build that gets deployed (npm run deploy): `ng build` with this
// build's version written into it, and version.json beside the app - the
// same version, which an open app compares its own to, to notice a newer
// deploy (src/app/services/version.ts).
//
// The version is the commit it was built from (its first seven digits)
// and that commit's date - "2026.10.01 · adc1c34"; a + after it means it
// was built with changes not committed yet. Same as the server's
// (server/src/utils/version.js).

const git = (command) =>
  execSync(`git ${command}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const commit = git('rev-parse --short=7 HEAD');
const date = git('log -1 --format=%cd --date=format:%Y.%m.%d');
const dirty = git('status --porcelain --untracked-files=no') ? '+' : '';
const build = {
  version: `${date} · ${commit}${dirty}`,
  commit,
  date,
  builtAt: new Date().toISOString(),
};

const ng = spawnSync(
  process.execPath,
  [
    'node_modules/@angular/cli/bin/ng.js',
    'build',
    '--define',
    `BODORGO_BUILD=${JSON.stringify(build)}`,
  ],
  { stdio: 'inherit' },
);
if (ng.status !== 0) process.exit(ng.status ?? 1);

// A Brotli copy (.br) beside every script, stylesheet and SVG: the live
// server has no Brotli module, so its .htaccess (live.htaccess here) hands
// these out to the browsers that take Brotli - a good tenth smaller than
// the gzip the others get. A copy that wouldn't be smaller isn't made.
const brotli = { files: 0, from: 0, to: 0 };
(function compress(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      compress(file);
    } else if (/\.(js|css|svg)$/.test(entry.name)) {
      const plain = fs.readFileSync(file);
      const packed = zlib.brotliCompressSync(plain, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: plain.length,
        },
      });
      if (packed.length >= plain.length) continue;
      fs.writeFileSync(`${file}.br`, packed);
      brotli.files += 1;
      brotli.from += plain.length;
      brotli.to += packed.length;
    }
  }
})(path.resolve('dist/client/browser'));
console.log(
  `✓ Brotli copies: ${brotli.files} files, ${Math.round(brotli.from / 1024)} kB → ${Math.round(brotli.to / 1024)} kB`,
);

// Last, as the sign that the build ran to its end (sync.js looks for it).
fs.writeFileSync(
  path.resolve('dist/client/browser/version.json'),
  `${JSON.stringify(build, null, 2)}\n`,
);
console.log(`✓ Built ${build.version}`);
