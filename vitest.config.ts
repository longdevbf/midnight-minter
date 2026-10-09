import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/test/**/*.test.ts', 'web/src/**/*.test.ts'],
    exclude: ['server/test/live/**'],
    testTimeout: 30_000,
  },
});
