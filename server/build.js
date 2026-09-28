import esbuild from 'esbuild';

esbuild
  .build({
    entryPoints: ['src/server.js'], // your main server file
    bundle: true,
    platform: 'node',
    // pdfkit and sharp are both dual CJS/ESM packages (see their own
    // package.json "exports" maps) whose ESM builds use import.meta.url
    // at module scope - pdfkit.node.mjs to locate a bundled ICC color
    // profile file, sharp's sharp.mjs/utility.mjs to build a `require`
    // for loading its native binary. esbuild resolves those ESM builds
    // here because our own source uses `import ... from 'pdfkit'/'sharp'`
    // - it picks the "import" condition based on that syntax regardless
    // of this bundle's own CJS output format. Once flattened into a CJS
    // bundle, import.meta.url has no real value (esbuild just substitutes
    // an empty object for CJS output), so `new URL(relative, undefined)`/
    // `createRequire(undefined)` throw the moment the bundle is loaded -
    // a real crash-loop this caused in production (the whole process
    // failed at boot, before it ever started listening, taking down every
    // route including login - not just PDF generation).
    //
    // Both are marked external instead of bundled, so this compiles down
    // to a plain runtime `require('pdfkit')`/`require('sharp')` - exactly
    // what a real Node process run from `S:\bodorgo` would do, correctly
    // picking up each package's own "require" condition (a genuinely
    // CJS-safe build in pdfkit's case, sidestepping import.meta.url
    // entirely) via its own real package.json once deployed alongside it
    // (see sync.js, which now ships node_modules/pdfkit - pure JS, no
    // native compilation, safe on any OS).
    //
    // sharp is NOT shipped the same way (yet) - it has a compiled native
    // addon per-platform, and this dev machine (Windows) can't produce
    // the NAS's actual Linux binary. Until that's set up properly,
    // tourPdfController.js's cover-image conversion (the one thing sharp
    // is actually used for now - see its own comment) is wrapped in a
    // try/catch that skips the cover photo if sharp can't load, rather
    // than failing PDF generation entirely.
    //
    // pdfjs-dist (a club document's first page, see
    // utils/documentPreviews.js) likewise: ESM-only, loaded by a dynamic
    // import(), and it finds its own native canvas (@napi-rs/canvas) at
    // runtime - both shipped by sync.js.
    external: ['pdfkit', 'sharp', 'pdfjs-dist', '@napi-rs/canvas'],
    // Deliberately CJS (esbuild's default for platform:'node'), not ESM:
    // the deploy target (S:\bodorgo on the NAS) has no package.json, so
    // Node treats the output there as CommonJS by default regardless of
    // this repo's own "type": "module". A CJS bundle gives every inlined
    // dependency a real `require`, avoiding esbuild's broken dynamic-require
    // shim under ESM output. Do not add `format: 'esm'` here without also
    // externalizing node_modules and shipping it to the deploy target.
    target: 'node22', // or node20 / node18 depending on your runtime
    outfile: 'dist/server.js',
    sourcemap: false,
    minify: true,
  })
  .catch(() => process.exit(1));
