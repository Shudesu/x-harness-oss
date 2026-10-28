const encoder = new TextEncoder();
export const externalSourcePath = (path: string) => /^\/api\/integrations\/agent-source\/(gates|[a-zA-Z0-9_-]{1,128}\/(mode|scan|page))$/.test(path);
export async function verifySourceSignature(request: Request, secret: string | undefined, raw: string) {
  if (!secret) return false;
  const stamp=request.headers.get('X-Harness-Source-Time') ?? '', signature=request.headers.get('X-Harness-Source-Signature') ?? '';
  if (!/^\d{13}$/.test(stamp) || Math.abs(Date.now()-Number(stamp))>60000 || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const path=new URL(request.url).pathname;
  if (!externalSourcePath(path)) return false;
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  return crypto.subtle.verify('HMAC',key,Uint8Array.from(signature.match(/../g)!,s=>parseInt(s,16)),encoder.encode(`xh-agent-source-v1\n${stamp}\n${request.method}\n${path}\n${raw}`));
}
