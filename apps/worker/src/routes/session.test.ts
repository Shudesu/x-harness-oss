import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { authMiddleware } from '../middleware/auth.js';
import type { Env } from '../index.js';
import { session } from './session.js';

const dbWithoutStaffKeys = {
  prepare: () => ({
    bind: () => ({
      first: async () => null,
    }),
  }),
} as unknown as D1Database;

function createApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.route('/', session);
  return app;
}

const bindings = {
  DB: dbWithoutStaffKeys,
  API_KEY: 'dashboard-admin-key',
  X_ACCESS_TOKEN: '',
  X_REFRESH_TOKEN: '',
  WORKER_URL: 'https://worker.example.test',
} as Env['Bindings'];

describe('GET /api/session', () => {
  it('rejects a missing dashboard API key', async () => {
    const response = await createApp().request('/api/session', undefined, bindings);

    expect(response.status).toBe(401);
  });

  it('rejects an invalid dashboard API key', async () => {
    const response = await createApp().request('/api/session', {
      headers: { Authorization: 'Bearer not-the-dashboard-key' },
    }, bindings);

    expect(response.status).toBe(401);
  });

  it('returns the authenticated dashboard session for the configured key', async () => {
    const response = await createApp().request('/api/session', {
      headers: { Authorization: 'Bearer dashboard-admin-key' },
    }, bindings);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { authenticated: true, role: 'admin', name: null },
    });
  });
});
