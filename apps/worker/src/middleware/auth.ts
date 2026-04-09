import type { Context, Next } from 'hono';
import { getStaffMemberByApiKey, updateStaffLastLogin } from '@x-harness/db';
import type { Env } from '../index.js';

export async function authMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  const path = new URL(c.req.url).pathname;
  if (path === '/api/health' || path === '/webhook/xaa' || path === '/api/followers/search' || path === '/api/users/search' || path === '/setup' || path.startsWith('/api/tokens/') || path.match(/^\/api\/engagement-gates\/[^/]+\/(verify|repliers)$/)) {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice('Bearer '.length);

  // Check env API_KEY first — always grants admin role
  if (token === c.env.API_KEY) {
    c.set('staffRole', 'admin');
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
