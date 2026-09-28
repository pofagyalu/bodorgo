import fs from 'fs';
import path from 'path';
import express from 'express';
import User from '../models/userModel.js';
import { buildOpenApi } from './openapi.js';

// /docs - the API documentation (Scalar, reading openapi.js), for admins
// only: it maps every endpoint, payments and settings included. Everything
// is served from here - Scalar's own file too, not from a CDN - so the
// server's strict script policy (helmet) needs no exception.

const router = express.Router();

// Scalar's browser bundle: copied next to server.js by build.js on the
// NAS; straight from node_modules on a dev machine.
const SCALAR_CANDIDATES = [
  path.resolve('apiDocs', 'scalar.js'),
  path.resolve('node_modules', '@scalar', 'api-reference', 'dist', 'browser', 'standalone.js'),
];
const scalarFile = () => SCALAR_CANDIDATES.find((f) => fs.existsSync(f));

const PAGE = `<!doctype html>
<html lang="hu">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Bódorgó API</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="/docs/scalar.js"></script>
    <script src="/docs/init.js"></script>
  </body>
</html>`;

// Scalar's settings - in a file of its own, since the script policy
// allows no inline script.
const INIT = `Scalar.createApiReference('#app', {
  url: '/docs/openapi.json',
  layout: 'modern',
  theme: 'default',
  withDefaultFonts: false,
  hideDownloadButton: false,
  defaultOpenAllTags: false,
  showSidebar: true,
  metaData: { title: 'Bódorgó API' },
  customCss: ':root { --scalar-color-accent: #1a796c; } .light-mode { --scalar-color-accent: #1a796c; } .dark-mode { --scalar-color-accent: #72b45d; }',
});
`;

const NO_ACCESS = (text) => `<!doctype html>
<html lang="hu">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Bódorgó API</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f0f2f5;
        font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #203747; }
      main { max-width: 420px; margin: 16px; padding: 28px; border-radius: 17px; background: #fff;
        box-shadow: 0 5px 19px #213b4110; }
      h1 { margin: 0 0 10px; font-size: 20px; }
      p { margin: 0; line-height: 1.5; color: #56666e; }
    </style>
  </head>
  <body>
    <main>
      <h1>Bódorgó API dokumentáció</h1>
      <p>${text}</p>
    </main>
  </body>
</html>`;

// Admins only - anyone else gets a short page instead of a bare error.
async function adminOnly(req, res, next) {
  const user = req.session?.user && (await User.findById(req.session.user.id).select('role'));
  if (user?.role === 'admin') return next();
  res
    .status(user ? 403 : 401)
    .type('html')
    .send(
      NO_ACCESS(
        user
          ? 'Ez az oldal csak adminoknak érhető el.'
          : 'Az API dokumentáció csak adminoknak érhető el. Jelentkezz be az alkalmazásban adminként, aztán nyisd meg újra ezt az oldalt.',
      ),
    );
}

router.use(adminOnly);

router.get('/', (req, res) => res.type('html').send(PAGE));

router.get('/init.js', (req, res) => res.type('text/javascript').send(INIT));

let spec;
router.get('/openapi.json', (req, res) => {
  spec ??= buildOpenApi({ version: '1.0' });
  res.json(spec);
});

router.get('/scalar.js', (req, res) => {
  const file = scalarFile();
  if (!file) return res.status(404).type('text/plain').send('Scalar is not installed.');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.type('text/javascript').sendFile(file);
});

export default router;
