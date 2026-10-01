const fs = require('fs');
const path = require('path');

// Publishes the build to the live site's folder (npm run deploy runs it
// after deploy-build.js).
//
// It never leaves the site without its pages: it refuses to start unless a
// finished, fresh build is there, and it copies the new files in before it
// removes the old ones. (It used to empty the folder first - run after a
// failed build, that took the site down, 2026-10-01.)

const source = path.resolve('dist/client/browser');
const dest = 'W:/bodorgo';

// A build older than this isn't the one just made - something went wrong
// before this step. (`--stale` publishes it anyway.)
const FRESH_MINUTES = 15;

function refuse(why) {
  console.error(`✗ Nothing published - ${why}`);
  console.error('  The live site is untouched. Build first: npm run deploy');
  process.exit(1);
}

// index.html: there is a build. version.json: deploy-build.js writes it as
// its last step, so the build ran to its end (a plain `ng build` has none).
if (!fs.existsSync(path.join(source, 'index.html'))) {
  refuse(`there is no build in ${source}.`);
}
const versionFile = path.join(source, 'version.json');
if (!fs.existsSync(versionFile)) {
  refuse('the build has no version.json - it was not made by deploy-build.js, or that failed.');
}
const build = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
const ageMinutes = (Date.now() - new Date(build.builtAt).getTime()) / 60000;
if (!(ageMinutes < FRESH_MINUTES) && !process.argv.includes('--stale')) {
  refuse(
    `the build (${build.version}) is ${Math.round(ageMinutes)} minutes old - not the one just made.`,
  );
}

// The new files first...
fs.cpSync(source, dest, { recursive: true, force: true });

// ...then out with what the new build no longer has (the previous deploy's
// content-hashed bundles would pile up otherwise) - but server-config
// files (like .htaccess) that aren't part of the build stay.
const KEEP = new Set(['.htaccess']);
const current = new Set(fs.readdirSync(source));
for (const entry of fs.readdirSync(dest)) {
  if (KEEP.has(entry) || current.has(entry)) continue;
  fs.rmSync(path.join(dest, entry), { recursive: true, force: true });
}

console.log(`✓ Synced dist/client/browser → W:/bodorgo (${build.version})`);
