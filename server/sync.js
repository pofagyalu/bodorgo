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
