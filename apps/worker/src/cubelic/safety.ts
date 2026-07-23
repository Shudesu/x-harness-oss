import type { Context, Next } from 'hono';
import type { Env } from '../index.js';

const PHASE_1_EXACT_ROUTES = new Set([
  'GET /api/health',
  'GET /api/session',
  'GET /api/capabilities',
  'GET /api/x-accounts',
]);

export function isCubelicSafeMode(env: Env['Bindings']): boolean {
  // Phase 1 is compile-time draft-only. An environment variable must not
  // reopen legacy publishing, scheduling, engagement, or DM write paths.
  void env;
  return true;
}

export function isPublishingGloballyDisabled(env: Env['Bindings']): boolean {
  return env.GLOBAL_PUBLISHING_DISABLED === 'true';
}

export function isPhase1RouteBlocked(method: string, path: string, env: Env['Bindings']): boolean {
  void env;
  if (method === 'OPTIONS') return false;
  if (path.startsWith('/api/cubelic/')) return false;
  if (PHASE_1_EXACT_ROUTES.has(`${method} ${path}`)) return false;
  return true;
}

export async function cubelicPhase1RouteGuard(c: Context<Env>, next: Next): Promise<Response | void> {
  const path = new URL(c.req.url).pathname;
  if (!isPhase1RouteBlocked(c.req.method, path, c.env)) return next();
  return c.json({
    success: false,
    error: 'CUBΣLIC Phase 1 blocks legacy X and administration routes',
    code: isPublishingGloballyDisabled(c.env) ? 'global_publishing_disabled' : 'cubelic_safe_mode',
  }, 423);
}
