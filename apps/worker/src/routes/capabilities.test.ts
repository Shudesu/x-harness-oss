import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { capabilities } from './capabilities.js';
import type { Env } from '../index.js';

describe('Phase 1 capabilities', () => {
  it('remain draft-only even when an environment variable requests legacy mode', async () => {
    const app = new Hono<Env>();
    app.route('/', capabilities);
    const response = await app.request('/api/capabilities', undefined, {
      CUBELIC_SAFE_MODE: 'false',
      GLOBAL_PUBLISHING_DISABLED: 'false',
    } as Env['Bindings']);
    const body = await response.json() as { data: { features: string[]; safety: Record<string, boolean> } };

    expect(body.data.features).toContain('cubelic-inert-drafts');
    expect(body.data.safety).toMatchObject({
      cubelicSafeMode: true,
      immediatePublishing: false,
      scheduling: false,
      dm: false,
      automatedEngagement: false,
      cookieScraping: false,
    });
  });
});
