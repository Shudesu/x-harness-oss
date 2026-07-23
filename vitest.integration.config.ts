import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.integration.test.ts', 'apps/worker/src/**/*.integration.test.ts'],
    hookTimeout: 20_000,
    testTimeout: 20_000,
  },
});
