import type { Context } from 'hono';
import type { Env } from '../index.js';
import { hashApiKey } from '@x-harness/db';
export async function takeQuota(db: D1Database, key: string, windowMs: number, limit: number): Promise<boolean> {
  const start = Math.floor(Date.now()/windowMs)*windowMs;
  const row = await db.prepare(`INSERT INTO rate_counters (key,window_start,count) VALUES (?,?,1) ON CONFLICT(key,window_start) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count`).bind(key,start,limit).first();
  return !!row && limit > 0;
}
export async function publicRateLimit(c: Context<Env>, kind: string, perMinute: number, perDay: number): Promise<boolean> {
  const ip = await hashApiKey(c.req.header('CF-Connecting-IP') || 'unknown');
  return await takeQuota(c.env.DB,`${kind}:${ip}`,60000,perMinute) && await takeQuota(c.env.DB,`${kind}:${ip}`,86400000,perDay);
}
