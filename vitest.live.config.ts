import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/test/live/**/*.test.ts'],
    testTimeout: 45 * 60_000,
    hookTimeout: 45 * 60_000,
    fileParallelism: false,
  },
});
