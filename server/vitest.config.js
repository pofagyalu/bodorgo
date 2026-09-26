import { defineConfig } from 'vitest/config';

// The server's automated tests (see tests/README.md). Every run uses its
// own throwaway in-memory MongoDB (tests/globalSetup.js) - never the real
// database, which local development shares with production.
export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/globalSetup.js'],
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.js'],
    // One in-memory MongoDB for the whole run, one database per test file -
    // files can safely run in parallel.
    testTimeout: 20000,
    hookTimeout: 60000, // the first run downloads the MongoDB binary
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/server.js'], // process bootstrap only (listen, signals)
      reporter: ['text-summary', 'text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // CI fails if coverage drops below these (raise to 80 later).
      thresholds: {
        lines: 70,
        statements: 70,
      },
    },
  },
});
