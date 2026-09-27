import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

const dest = 'S:/bodorgo';

fs.cpSync(path.resolve('dist'), dest, { recursive: true, force: true });
console.log('✓ Synced dist → S:/bodorgo');

// documents/ holds files served only through the requireAuth-gated
// /documents route (see documentController.js) - not part of dist/, so it
// needs its own copy step, same reasoning as why public/img isn't just
// bundled into dist either. Not tracked in git (see .gitignore) - this
// copy is the only way a document uploaded through the local app reaches
// production. documents/payments/ is excluded - unlike the rest of this
// folder (admin-uploaded club records), those are auto-generated
// per-payment receipts
// containing personal financial details, per-environment dynamic data
// that must never be pushed from this dev machine over production's own
// real ones (or vice versa) - see .gitignore's own comment on the same
// exclusion.
fs.cpSync(path.resolve('documents'), path.join(dest, 'documents'), {
  recursive: true,
  force: true,
  filter: (src) => path.relative(path.resolve('documents'), src).split(path.sep)[0] !== 'payments',
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

// pdfkit is marked `external` in build.js (see its comment) rather than
// bundled, so the deployed server.js does a plain runtime require('pdfkit')
// - which needs pdfkit AND its own full dependency tree physically
// present alongside it (pdfkit's pre-built js/pdfkit.js itself does real
// requires of these, e.g. '@noble/hashes/utils' for PDF signing support -
// that's not inlined into pdfkit's own bundle). All pure JS, no native
// compilation, so copying them as-is from this (Windows) dev machine
// works identically on the NAS's Linux. This exact package list is
// pdfkit's full transitive closure per package-lock.json - regenerate it
// with the one-liner in this file's git history if pdfkit's own
// dependencies ever change. sharp is shipped separately, below - it has a
// compiled native part, so it needs its Linux build, not this machine's.
const PDFKIT_DEPENDENCY_CLOSURE = [
  'pdfkit',
  '@noble/ciphers',
  '@noble/hashes',
  '@swc/helpers',
  'base64-js',
  'brotli',
  'clone',
  'dfa',
  'fast-deep-equal',
  'fflate',
  'fontkit',
  'linebreak',
  'pako',
  'png-js',
  'restructure',
  'tiny-inflate',
  'tslib',
  'unicode-properties',
  'unicode-trie',
];
for (const pkg of PDFKIT_DEPENDENCY_CLOSURE) {
  fs.cpSync(path.resolve('node_modules', pkg), path.join(dest, 'node_modules', pkg), {
    recursive: true,
    force: true,
  });
}
console.log(
  `✓ Synced pdfkit + its ${PDFKIT_DEPENDENCY_CLOSURE.length - 1} dependencies → S:/bodorgo/node_modules`,
);

// sharp (thumbnails for "Új média felfedezése", see src/photos/) is
// external too, but it has a compiled native part: the NAS needs sharp's
// Linux x64 build, not this Windows machine's. npm fetches exactly that
// into a temporary folder (--os/--cpu/--libc), and only the packages sharp
// needs on Linux are copied next to pdfkit - not its optional WebAssembly
// fallback, whose tslib would overwrite pdfkit's. Done again only when the
// sharp version changes (the marker file below).
const sharpVersion = JSON.parse(
  fs.readFileSync(path.resolve('node_modules/sharp/package.json'), 'utf8'),
).version;
const sharpMarker = path.join(dest, 'node_modules', 'sharp', '.linux-x64-build');
const shippedVersion = fs.existsSync(sharpMarker) ? fs.readFileSync(sharpMarker, 'utf8') : null;
if (shippedVersion !== sharpVersion) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'bodorgo-sharp-linux-'));
  execSync(
    `npm install sharp@${sharpVersion} --os=linux --cpu=x64 --libc=glibc --no-save --no-package-lock --no-audit --no-fund --omit=dev`,
    { cwd: staging, stdio: 'ignore' },
  );
  const SHARP_LINUX_PACKAGES = [
    'sharp',
    '@img/sharp-linux-x64',
    '@img/sharp-libvips-linux-x64',
    '@img/colour',
    'detect-libc',
    'semver',
  ];
  for (const pkg of SHARP_LINUX_PACKAGES) {
    fs.cpSync(path.join(staging, 'node_modules', pkg), path.join(dest, 'node_modules', pkg), {
      recursive: true,
      force: true,
    });
  }
  fs.writeFileSync(sharpMarker, sharpVersion);
  fs.rmSync(staging, { recursive: true, force: true });
  console.log(`✓ Shipped sharp ${sharpVersion} (Linux x64) → S:/bodorgo/node_modules`);
} else {
  console.log(`✓ sharp ${sharpVersion} (Linux x64) already on S:/bodorgo`);
}
