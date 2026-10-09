const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Tells the built service worker (dist/.../sw.js, from src/sw.js) which
// files this build is made of - what it keeps on the device, so the app
// opens without a connection. Run after `ng build`: deploy-build.js does,
// and it can be run by hand after any build (`node sw-files.js`).
//
// The list goes in as a line above the worker's own code, with a version:
// a code of the list and of what the files under plain names hold (a
// bundle's name already says what it holds). A build that changed nothing
// has the same version, and the devices keep what they have.

const DIST = path.resolve(__dirname, 'dist/client/browser');

// What the app needs to run: the page, scripts, styles, the fonts as WOFF2
// (every browser that can keep them takes those), icons and small pictures,
// the data files. Not the other font formats, the downloads (zip), and the
// one picture only the login page's wide layout has.
const KEPT = /\.(html|js|css|woff2|png|svg|webp|ico|json|webmanifest)$/;
const LEFT_OUT = new Set(['/sw.js', '/version.json']);
const HASHED = /-[A-Z0-9]{8}\.[a-z0-9]+$/;

function keepFiles(dist = DIST) {
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else files.push(`/${path.relative(dist, file).split(path.sep).join('/')}`);
    }
  })(dist);
  const kept = files.filter((url) => KEPT.test(url) && !LEFT_OUT.has(url)).sort();

  const hash = crypto.createHash('sha1');
  let bytes = 0;
  for (const url of kept) {
    const content = fs.readFileSync(path.join(dist, url));
    bytes += content.length;
    hash.update(url);
    if (!HASHED.test(url)) hash.update(content);
  }
  const shell = { version: hash.digest('hex').slice(0, 12), files: kept };

  const worker = path.join(dist, 'sw.js');
  // Run twice on one build, the line is written once.
  const code = fs.readFileSync(worker, 'utf8').replace(/^self\.__SHELL = .*\n/, '');
  fs.writeFileSync(worker, `self.__SHELL = ${JSON.stringify(shell)};\n${code}`);
  console.log(
    `✓ Offline: ${kept.length} files kept on the device, ${(bytes / 1024 / 1024).toFixed(1)} MB (${shell.version})`,
  );
  return shell;
}

module.exports = { keepFiles };
if (require.main === module) keepFiles();
