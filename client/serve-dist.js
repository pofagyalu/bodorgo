const fs = require('fs');
const http = require('http');
const path = require('path');

// Serves a finished build (dist/client/browser) the way the live web server
// does - the files, and index.html for every address of the app - so the
// built app, with its service worker, can be tried on this machine:
//
//   npx ng build --configuration development   (talks to the local server)
//   node sw-files.js                           (the worker's list of files)
//   node serve-dist.js                         (http://localhost:4200)
//
// `ng serve` has to be stopped first: the local server takes requests from
// localhost:4200 only. Another port, or another folder: node serve-dist.js
// 4300 some/folder.

const port = Number(process.argv[2]) || 4200;
const root = path.resolve(process.argv[3] || path.join(__dirname, 'dist/client/browser'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.zip': 'application/zip',
};

http
  .createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = path.join(root, pathname);
    // Nothing outside the build; an address that is no file is the app's.
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (path.extname(pathname)) {
        res.writeHead(404).end('Not found');
        return;
      }
      file = path.join(root, 'index.html');
    }
    const name = path.basename(file);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      // As on the live site (live.htaccess): the page and the worker are
      // always asked for afresh.
      'Cache-Control': /^(index\.html|sw\.js|version\.json)$/.test(name)
        ? 'no-cache'
        : 'max-age=60',
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`✓ ${root} → http://localhost:${port}`));
