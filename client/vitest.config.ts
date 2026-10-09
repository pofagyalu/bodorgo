import { defineConfig } from 'vitest/config';

// What the Angular test builder (angular.json's "test": runnerConfig) adds
// to its own Vitest settings: the time limits.
//
// The heavier specs (a whole settings page, the rich text editor loading)
// run in a second or two on a free PC - and past Vitest's own limits (5 s a
// test, 10 s a hook) on the NAS, where the pull requests are checked and
// the whole suite takes ten times as long, or on a PC busy with something
// else. On the NAS even the simplest spec's first step has taken over 30 s
// while two checks ran at once. Room enough for that; a test that really
// hangs still fails, only later.
export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
