import { describe, it, expect, vi, beforeEach } from 'vitest';

const consumerSecretPlain = 'secret1';
const accounts = [
  { id: 'acc1', x_user_id: '111', username: 'alice', consumer_key: 'ck1', consumer_secret: 'ENC:secret1', access_token: 'ENC:at1', access_token_secret: 'ENC:ats1' },
];
const xaaEventInserts: unknown[] = [];
const rateCalls: string[] = [];
let rateLimited = false;

vi.mock('@x-harness/db', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  decryptSecret: vi.fn(async (value: string) => value.replace(/^ENC:/, '')),
  getXAccounts: vi.fn(async () => accounts),
  getXAccountById: vi.fn(async (_db: unknown, id: string) => accounts.find((a) => a.id === id) ?? null),
  insertXaaEvent: vi.fn(async (_db: unknown, _eventType: string, payload: unknown) => { xaaEventInserts.push(payload); }),
  recordSpend: vi.fn(async () => {}),
}));

import { xaa } from '../xaa.js';

const EXEC_CTX = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

function makeDb() {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              if (sql.includes('INSERT INTO rate_counters')) {
                rateCalls.push(String(args[0]));
                return (rateLimited ? null : { count: 1 }) as T;
              }
              if (sql.includes('INSERT OR IGNORE INTO ai_locks')) return { id: 'lock' } as T;
              return null;
            },
            async all<T>() { return { results: [] as T[] }; },
            async run() { return { success: true }; },
          };
        },
      };
    },
  } as unknown as D1Database;
}

const envBase = { ENCRYPTION_KEY: 'k'.repeat(32), WORKER_URL: 'https://worker.example' };

async function hmacSha256(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  return `sha256=${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
}

const crc = (token: string) => xaa.request(
  `/webhook/xaa?crc_token=${encodeURIComponent(token)}&accountId=acc1`,
  {},
  { ...envBase, DB: makeDb() } as any,
  EXEC_CTX,
);

beforeEach(() => {
  xaaEventInserts.length = 0;
  rateCalls.length = 0;
  rateLimited = false;
});

describe('GET /webhook/xaa CRC hardening', () => {
  it('still answers a realistic base64-style X challenge', async () => {
    const token = 'NjM4MzI0ODk2MjQyNjU3MjM5+abc/DEF_ghi-jkl.mno~pq==';
    const res = await crc(token);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { response_token: string }).response_token).toBe(await hmacSha256(consumerSecretPlain, token));
    expect(rateCalls.length).toBeGreaterThan(0);
  });

  it('rejects a missing crc_token with 400', async () => {
    const res = await xaa.request('/webhook/xaa?accountId=acc1', {}, { ...envBase, DB: makeDb() } as any, EXEC_CTX);
    expect(res.status).toBe(400);
  });

  it.each([
    ['a JSON object (would forge a POST signature)', JSON.stringify({ for_user_id: '111', data: { event_type: 'post.create' } })],
    ['whitespace', 'abc def'],
    ['a quote', 'abc"def'],
    ['a colon', 'abc:def'],
    ['a brace', '{abc'],
    ['non-ASCII', 'abcé'],
    ['an over-long token', 'a'.repeat(257)],
  ])('rejects %s with 400 and signs nothing', async (_label, token) => {
    const res = await crc(token);
    expect(res.status).toBe(400);
    expect(((await res.json()) as Record<string, unknown>).response_token).toBeUndefined();
    expect(rateCalls.length).toBe(0);
  });

  it('accepts a token at the 256-character limit', async () => {
    expect((await crc('a'.repeat(256))).status).toBe(200);
  });

  it('returns 429 without a signature when the per-IP limit is exhausted', async () => {
    rateLimited = true;
    const res = await crc('validtoken123');
    expect(res.status).toBe(429);
    expect(((await res.json()) as Record<string, unknown>).response_token).toBeUndefined();
  });

  it('rejects a non-object JSON body on POST even if it is correctly signed', async () => {
    const raw = '12345';
    const res = await xaa.request(
      '/webhook/xaa?accountId=acc1',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-twitter-webhooks-signature': await hmacSha256(consumerSecretPlain, raw) }, body: raw },
      { ...envBase, DB: makeDb() } as any,
      EXEC_CTX,
    );
    expect(res.status).toBe(400);
    expect(xaaEventInserts).toHaveLength(0);
  });
});
