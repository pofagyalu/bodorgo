import js from '@eslint/js';
import n from 'eslint-plugin-n';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// The server's lint rules: ESLint's and Node's recommended sets. Formatting
// is Prettier's job (npm run format / format:check), so every rule that
// would clash with it is switched off (eslint-config-prettier, last).
export default [
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'public/', 'documents/', 'logs/'] },
  js.configs.recommended,
  n.configs['flat/recommended-module'],
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // Express error handlers must keep all four arguments, even unused
      // ones; a leading underscore marks anything unused on purpose.
      'no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_|^next$',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
      // The app runs as its own process (pm2) - exiting on a fatal error
      // is intended (see server.js).
      'n/no-process-exit': 'off',
    },
  },
  {
    // Tests, their helpers, build and one-off scripts may use development
    // packages (vitest, supertest, esbuild...).
    files: [
      'tests/**',
      'scripts/**',
      'build.js',
      'sync.js',
      'vitest.config.js',
      'eslint.config.js',
    ],
    rules: { 'n/no-unpublished-import': 'off', 'n/no-extraneous-import': 'off' },
  },
  prettier,
];
