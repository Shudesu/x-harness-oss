import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/worker/src/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
