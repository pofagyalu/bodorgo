import fs from 'fs';
import path from 'path';

const dest = 'S:/bodorgo';

fs.cpSync(path.resolve('dist'), dest, { recursive: true, force: true });
console.log('✓ Synced dist → S:/bodorgo');

// documents/ holds files served only through the requireAuth-gated
// /documents route (see documentController.js) - not part of dist/, so it
// needs its own copy step, same reasoning as why public/img isn't just
// bundled into dist either.
fs.cpSync(path.resolve('documents'), path.join(dest, 'documents'), {
  recursive: true,
  force: true,
});
console.log('✓ Synced documents → S:/bodorgo/documents');

// assets/ holds files read directly off disk by server code (currently:
// the TTF fonts tourPdfController.js embeds for Hungarian ő/ű support,
// which pdfkit's built-in fonts lack) - unlike public/, this is meant to
// be git-tracked and deployed automatically, not manually placed on the
// NAS share by hand (a manual step already caused one real missing-file
// bug for a tour cover image - see the git history around that).
fs.cpSync(path.resolve('assets'), path.join(dest, 'assets'), {
  recursive: true,
  force: true,
});
console.log('✓ Synced assets → S:/bodorgo/assets');
