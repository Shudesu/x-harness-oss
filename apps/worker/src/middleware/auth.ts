import type { Context, Next } from 'hono';
import { getStaffMemberByApiKey, updateStaffLastLogin } from '@x-harness/db';
import type { Env } from '../index.js';

export async function authMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  const path = new URL(c.req.url).pathname;
  if (path === '/api/health' || path === '/webhook/xaa' || path === '/api/followers/search' || path === '/api/users/search' || path === '/setup' || path.startsWith('/api/tokens/') || path.startsWith('/api/growth/img/') || path.match(/^\/api\/engagement-gates\/[^/]+\/(verify|repliers)$/)) {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice('Bearer '.length);

  if (path.startsWith('/api/cubelic/') && c.env.HERMES_ACCESS_TOKEN && token === c.env.HERMES_ACCESS_TOKEN) {
    const hermesAllowed = c.req.method === 'GET'
      || (c.req.method === 'POST' && [
        '/api/cubelic/events',
        '/api/cubelic/content',
        '/api/cubelic/media/validate',
        '/api/cubelic/rights/validate',
        '/api/cubelic/setlists/ingest',
        '/api/cubelic/drafts/generate',
        '/api/cubelic/metrics/collect',
      ].includes(path))
      || (
        c.env.CUBELIC_PHASE3_ENABLED === 'true'
        && c.env.PHASE3_RELEASE_APPROVED === 'true'
        && c.env.STAGING_PHASE3_SMOKE_VERIFIED === 'true'
        && c.req.method === 'POST'
        && /^\/api\/cubelic\/drafts\/[^/]+\/schedule$/.test(path)
      );
    if (!hermesAllowed) return c.json({ success: false, error: 'Forbidden for Hermes credential' }, 403);
    c.set('requestActor', 'hermes');
    return next();
  }

  // Check env API_KEY first — always grants admin role
  if (c.env.API_KEY && token === c.env.API_KEY) {
    c.set('staffRole', 'admin');
    c.set('requestActor', 'human');
    return next();
  }

  // Fall back to per-staff API key lookup
  const staff = await getStaffMemberByApiKey(c.env.DB, token);
  if (!staff) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  c.set('staffRole', staff.role);
  c.set('staffId', staff.id);
  c.set('staffName', staff.name);
  c.set('requestActor', 'human');

  // Block viewer role from mutating routes outside /api/staff
  if (staff.role === 'viewer') {
    const method = c.req.method;
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method) && !path.startsWith('/api/staff')) {
      return c.json({ success: false, error: 'Forbidden: viewer role cannot perform mutating operations' }, 403);
    }
  }

  // Fire-and-forget: update last_login_at without blocking the response
  c.executionCtx.waitUntil(updateStaffLastLogin(c.env.DB, staff.id));

  return next();
}

/**
 * Check if the current request's staff role satisfies one of the allowed roles.
 * Returns a 403 Response if not authorized, or null if allowed.
 */
export function requireRole(
  c: Context<Env>,
  ...roles: Array<'admin' | 'editor' | 'viewer'>
): Response | null {
  const staffRole = c.get('staffRole');
  if (!staffRole || !roles.includes(staffRole)) {
    return c.json({ success: false, error: 'Forbidden' }, 403) as Response;
  }
  return null;
}
