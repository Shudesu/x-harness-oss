import { defineConfig } from 'vitest/config';
import path from 'node:path';
const line = process.env.LINE_GATE_REPO;
if (!line) throw new Error('Set LINE_GATE_REPO to the matching line-harness checkout');
export default defineConfig({
  resolve: {
    alias: {
      '@line-crm/db': path.resolve(line, 'packages/db/src/index.ts'),
      '@line-crm/shared': path.resolve(line, 'packages/shared/src/index.ts'),
      '@line-crm/line-sdk': path.resolve(line, 'packages/line-sdk/src/index.ts'),
      'cloudflare:workers': path.resolve(
        line,
        'apps/worker/src/test-support/cloudflare-workers-stub.ts',
      ),
    },
  },
  test: { include: ['tests/integration/*.integration.ts'], testTimeout: 20000 },
});
