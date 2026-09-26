import { it, expect } from 'vitest';

// Throwaway: only here to check that a red test run blocks merging.
// This branch/PR must never be merged.
it('fails on purpose', () => {
  expect(1 + 1).toBe(3);
});
