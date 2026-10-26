const encoder = new TextEncoder();
function base64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }
function bytes(s: string): Uint8Array { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
async function key(secret: string | undefined) {
  if (!secret) throw new Error('ENCRYPTION_KEY is required');
  const raw = bytes(secret);
  if (raw.length !== 32) throw new Error('ENCRYPTION_KEY must be base64 encoded 32 bytes');
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt','decrypt']);
}
export async function encryptSecret(value: string, secret: string | undefined): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(secret), encoder.encode(value));
  return `enc:v1:${base64(iv)}:${base64(new Uint8Array(encrypted))}`;
}
export async function decryptSecret(value: string, secret: string | undefined): Promise<string> {
  // Legacy plaintext reads allow a staged migration. All new writes are encrypted.
  if (!value.startsWith('enc:')) return value;
  const [prefix, version, iv, payload] = value.split(':');
  if (prefix !== 'enc' || version !== 'v1' || !iv || !payload) throw new Error('Invalid encrypted secret');
  const plain = await crypto.subtle.decrypt({ name:'AES-GCM', iv:bytes(iv) as BufferSource }, await key(secret), bytes(payload) as BufferSource);
  return new TextDecoder().decode(plain);
}
export async function hashApiKey(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), b => b.toString(16).padStart(2,'0')).join('');
}
export async function secureEqual(a: string, b: string): Promise<boolean> {
  const [ah,bh] = await Promise.all([hashApiKey(a),hashApiKey(b)]);
  let diff = 0; for(let i=0;i<ah.length;i++) diff |= ah.charCodeAt(i)^bh.charCodeAt(i);
  return diff === 0;
}
