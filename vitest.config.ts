import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/worker/src/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
  },
});
