import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/test/live/**/*.test.ts'],
    testTimeout: 2 * 60 * 60_000,
    hookTimeout: 2 * 60 * 60_000,
    fileParallelism: false,
  },
});
