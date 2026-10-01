const fs = require('fs');
const path = require('path');
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

fs.writeFileSync(
  path.resolve('dist/client/browser/version.json'),
  `${JSON.stringify(build, null, 2)}\n`,
);
console.log(`✓ Built ${build.version}`);
