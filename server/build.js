import esbuild from 'esbuild';

esbuild
  .build({
    entryPoints: ['src/server.js'], // your main server file
    bundle: true,
    platform: 'node',
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
