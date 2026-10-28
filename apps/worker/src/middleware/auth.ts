import { externalSourcePath, verifySourceSignature } from '../services/external-source-auth.js';
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
  if (externalSourcePath(path) && c.req.header('X-Harness-Source-Signature')) {
    if (Number(c.req.header('Content-Length'))>131072) return c.json({success:false,error:'page_too_large'},413);
    const reader=c.req.raw.clone().body?.getReader();let raw='';let bytes=0;const decoder=new TextDecoder();
    if(reader)try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;
      if(bytes>131072){void reader.cancel();return c.json({success:false,error:'page_too_large'},413);}
      raw+=decoder.decode(part.value,{stream:true});
    }raw+=decoder.decode();}finally{reader.releaseLock();}
    if (!await verifySourceSignature(c.req.raw,c.env.ADMIN_SSO_SECRET,raw)) return c.json({success:false,error:'Unauthorized'},401);
    c.set('staffRole','admin');return next();
  }
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
