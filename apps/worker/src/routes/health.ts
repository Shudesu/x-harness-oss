import { APP_VERSION } from '@x-harness/shared';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const health = new Hono<Env>();

health.get('/api/health', (c) => {
  return c.json({ success: true, data: { status: 'ok', version: APP_VERSION } });
});

export { health };
