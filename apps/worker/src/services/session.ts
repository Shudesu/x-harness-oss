import { getStaffMemberByApiKey, getStaffMemberById, secureEqual, hashApiKey } from '@x-harness/db';
import type { Env } from '../index.js';
type Identity = { role: 'admin'|'editor'|'viewer'; id?: string; name?: string };
async function signingKey(env: Env['Bindings']) {
  if (!env.API_KEY) throw new Error('API_KEY is required');
  return crypto.subtle.importKey('raw',new TextEncoder().encode(`xh-session-v1:${env.API_KEY}`),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
function encode(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''); }
function decode(s: string) { return Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0)); }
export async function authenticate(env: Env['Bindings'], token: string): Promise<Identity|null> {
  if (!token) return null;
  if (token.startsWith('xhs.')) {
    try {
      const parts = token.split('.'); if(parts.length !== 3) return null;
      if (!await crypto.subtle.verify('HMAC', await signingKey(env), decode(parts[2]), new TextEncoder().encode(parts[1]))) return null;
      const payload = JSON.parse(new TextDecoder().decode(decode(parts[1])));
      if (!Number.isFinite(payload.exp) || payload.exp <= Date.now()) return null;
      if (payload.sub === 'master') return {role:'admin'};
      const staff = await getStaffMemberById(env.DB,payload.sub);
      if (!staff?.is_active) return null;
      return {role:staff.role,id:staff.id,name:staff.name};
    } catch { return null; }
  }
  if (env.API_KEY && await secureEqual(token,env.API_KEY)) return {role:'admin'};
  const staff = await getStaffMemberByApiKey(env.DB,token);
  return staff ? {role:staff.role,id:staff.id,name:staff.name} : null;
}
export async function createSession(env: Env['Bindings'], identity: Identity) {
  const expiresAt = Date.now()+12*3600000;
  const payload = encode(new TextEncoder().encode(JSON.stringify({sub:identity.id ?? 'master',exp:expiresAt})));
  const sig = await crypto.subtle.sign('HMAC',await signingKey(env),new TextEncoder().encode(payload));
  return {token:`xhs.${payload}.${encode(new Uint8Array(sig))}`,expiresAt,role:identity.role};
}
