import type { Context, Next } from 'hono';
import type { Env } from '../index.js';

const LEGACY_X_WRITE_PREFIXES = [
  '/api/posts',
  '/api/dm',
  '/api/engagement',
  '/api/engagement-gates',
  '/api/step-sequences',
  '/api/campaigns',
  '/api/articles',
  '/api/growth',
  '/api/users',
] as const;

export function isCubelicSafeMode(env: Env['Bindings']): boolean {
  // Phase 1 is compile-time draft-only. An environment variable must not
  // reopen legacy publishing, scheduling, engagement, or DM write paths.
  void env;
  return true;
}

export function isPublishingGloballyDisabled(env: Env['Bindings']): boolean {
  return env.GLOBAL_PUBLISHING_DISABLED === 'true';
}

export function isLegacyXWriteBlocked(method: string, path: string, env: Env['Bindings']): boolean {
  void env;
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false;
  if (path.startsWith('/api/cubelic/')) return false;
  return LEGACY_X_WRITE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export async function cubelicLegacyWriteGuard(c: Context<Env>, next: Next): Promise<Response | void> {
  const path = new URL(c.req.url).pathname;
  if (!isLegacyXWriteBlocked(c.req.method, path, c.env)) return next();
  return c.json({
    success: false,
    error: 'CUBΣLIC safety controls block legacy X write and automation routes',
    code: isPublishingGloballyDisabled(c.env) ? 'global_publishing_disabled' : 'cubelic_safe_mode',
  }, 423);
}
