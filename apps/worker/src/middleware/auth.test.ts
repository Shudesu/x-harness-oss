import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { authMiddleware } from './auth.js';
import type { Env } from '../index.js';

function app() {
  const value = new Hono<Env>();
  value.use('*', authMiddleware);
  value.post('/api/cubelic/drafts/:id/schedule', (c) => c.json({
    actor: c.get('requestActor'),
  }));
  return value;
}

describe('Phase 3 Hermes authentication boundary', () => {
  it('allows only the exact schedule route after every runtime release gate is active', async () => {
    const response = await app().request(
      'https://worker.test/api/cubelic/drafts/drf_1/schedule',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer hermes-secret' },
      },
      {
        HERMES_ACCESS_TOKEN: 'hermes-secret',
        CUBELIC_PHASE3_ENABLED: 'true',
        PHASE3_RELEASE_APPROVED: 'true',
        STAGING_PHASE3_SMOKE_VERIFIED: 'true',
      } as Env['Bindings'],
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ actor: 'hermes' });
  });

  it('rejects Hermes scheduling when a runtime release gate is absent', async () => {
    const response = await app().request(
      'https://worker.test/api/cubelic/drafts/drf_1/schedule',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer hermes-secret' },
      },
      {
        HERMES_ACCESS_TOKEN: 'hermes-secret',
        CUBELIC_PHASE3_ENABLED: 'true',
        PHASE3_RELEASE_APPROVED: 'true',
      } as Env['Bindings'],
    );
    expect(response.status).toBe(403);
  });
});
