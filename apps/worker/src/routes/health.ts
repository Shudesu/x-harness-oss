import { Hono } from 'hono';
import type { Env } from '../index.js';

const health = new Hono<Env>();

health.get('/api/health', (c) => {
  return c.json({ success: true, data: { status: 'ok', version: '0.6.0' } });
});

export { health };
