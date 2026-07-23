import { Hono } from 'hono';
import type { Env } from '../index.js';

const session = new Hono<Env>();

session.get('/api/session', (c) => {
  return c.json({
    success: true,
    data: {
      authenticated: true,
      role: c.get('staffRole'),
      name: c.get('staffName') ?? null,
    },
  });
});

export { session };
