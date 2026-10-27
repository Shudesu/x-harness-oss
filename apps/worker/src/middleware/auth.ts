import type { Context, Next } from 'hono';
import type { Env } from '../index.js';
import { authenticate } from '../services/session.js';
export function isPublicPath(path: string): boolean {
  return ['/api/health','/api/auth/session','/api/x/oauth/callback','/webhook/xaa','/setup'].includes(path)
    || /^\/api\/tokens\/[^/]+\/resolve$/.test(path) || path.startsWith('/api/growth/img/')
    || /^\/api\/integrations\/line-harness\/(claims(?:\/check)?|events)$/.test(path)
    || /^\/c\/[a-z0-9-]+(?:\/(go|og\.png|status\.json))?$/.test(path);
}
export async function authMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  const path = new URL(c.req.url).pathname;
  const header = c.req.header('Authorization');
  const identity = header?.startsWith('Bearer ') ? await authenticate(c.env,header.slice(7)) : null;
  if (identity) { c.set('staffRole',identity.role); c.set('staffId',identity.id); c.set('staffName',identity.name); }
  if (isPublicPath(path)) return next();
  if (!identity) return c.json({success:false,error:'Unauthorized'},401);
  const mutation = !['GET','HEAD','OPTIONS'].includes(c.req.method);
  const admin = path !== '/api/staff/me' && /^\/api\/(settings|line-connections|staff|xaa|maintenance)(\/|$)/.test(path)
    || (mutation && /^\/api\/x-accounts(\/|$)/.test(path));
  if ((admin && identity.role !== 'admin') || (mutation && identity.role === 'viewer')) return c.json({success:false,error:'Forbidden'},403);
  return next();
}
export function requireRole(c: Context<Env>, ...roles: Array<'admin'|'editor'|'viewer'>): Response|null {
  const role = c.get('staffRole');
  return role && roles.includes(role) ? null : c.json({success:false,error:'Forbidden'},403) as Response;
}
