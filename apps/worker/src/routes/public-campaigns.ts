import { getPublicCampaignStatus } from '../services/campaign-status.js';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Env } from '../index.js';
import type { ClaimGate } from '../services/claim-types.js';
import { intentUrl } from '../services/claim-codes.js';
import { publicRateLimit } from '../services/rate-limit.js';
const publicCampaigns = new Hono<Env>();
function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
async function load(c: import('hono').Context<Env>) {
  return c.env.DB.prepare(
    "SELECT g.*,c.worker_url FROM engagement_gates g JOIN line_connections c ON c.id=g.line_connection_id WHERE g.slug=? AND g.gate_mode='line_first' AND g.gate_state='active'",
  )
    .bind(c.req.param('slug'))
    .first<ClaimGate & { worker_url: string }>();
}
publicCampaigns.get('/c/:slug', async (c) => {
  const gate = await load(c);
  if (!gate) return c.text('キャンペーンが見つかりません', 404);
  const base = new URL(c.env.WORKER_URL).origin,
    canonical = `${base}/c/${gate.slug}`,
    image = `${canonical}/og.png`;
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(gate.title)}</title><meta property="og:title" content="${escape(gate.title)}"><meta property="og:description" content="LINEで自分専用の合言葉を受け取って参加できます。"><meta property="og:type" content="website"><meta property="og:url" content="${escape(canonical)}"><meta property="og:image" content="${escape(image)}"><meta name="twitter:card" content="summary_large_image"></head><body><p>${escape(gate.title)}</p></body></html>`;
  if (
    /bot|crawler|spider|preview|facebookexternalhit|twitterbot/i.test(
      c.req.header('User-Agent') ?? '',
    )
  )
    return c.html(html);
  if (!gate.is_active || Date.parse(gate.ends_at) < Date.now())
    return c.html(html.replace('</body>', '<p>このキャンペーンは終了しました。</p></body>'), 410);
  if (!(await publicRateLimit(c, 'gate-view', 30, 500)))
    return c.text('時間をおいてお試しください', 429);
  let session = getCookie(c, 'xh_gate_sid');
  if (!session || !/^[a-f0-9-]{36}$/.test(session)) {
    session = crypto.randomUUID();
    setCookie(c, 'xh_gate_sid', session, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 86400,
      path: '/c',
    });
  }
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO gate_events(id,gate_id,session_id,type,at,dedup_key) VALUES (?,?,?,'view',?,?)",
  )
    .bind(crypto.randomUUID(), gate.id, session, Date.now(), `view:${gate.id}:${session}`)
    .run();
  if (!gate.tracked_link_ref) return c.text('準備中です', 503);
  const target = new URL(`/r/${encodeURIComponent(gate.tracked_link_ref)}`, gate.worker_url);
  target.searchParams.set('gate', gate.id);
  if (gate.entry_page === 'status') {
    const status = await getPublicCampaignStatus(c.env.DB, gate);
    const nonce = crypto.randomUUID();
    c.header(
      'Content-Security-Policy',
      `default-src 'none'; style-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'`,
    );
    c.header('Cache-Control', 'no-store');
    return c.html(
      `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(gate.title)}</title><style nonce="${nonce}">body{font:18px system-ui;max-width:480px;margin:40px auto;padding:24px;line-height:1.8}a{display:block;background:#087c42;color:white;padding:18px;border-radius:12px;text-align:center}</style><h1>${escape(gate.title)}</h1><p>${status.unlimited ? '在庫上限なし' : `残り ${status.remaining} 名`}${status.participants === null ? '' : `・参加 ${status.participants} 人${status.participants >= 100 ? '以上' : ''}`}</p><p>〆切 ${escape(new Date(gate.ends_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }))} JST</p><a href="${escape(target.toString())}">LINEで参加する</a></html>`,
    );
  }
  c.header('Location', target.toString());
  c.header('Cache-Control', 'no-store');
  return c.html(html, 302);
});
publicCampaigns.get('/c/:slug/status.json', async (c) => {
  const keyUrl = new URL(c.req.url);
  keyUrl.search = '';
  const key = new Request(keyUrl);
  const cache =
    typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : undefined;
  const cached = await cache?.match(key);
  if (cached) {
    const r = new Response(cached.body, cached);
    r.headers.set('Cache-Control', 'public, max-age=15');
    return r;
  }
  if (!(await publicRateLimit(c, 'gate-status', 30, 500)))
    return c.json({ error: 'Try again later' }, 429);
  const gate = await c.env.DB.prepare(
    "SELECT * FROM engagement_gates WHERE slug=? AND gate_mode='line_first' AND gate_state IN ('active','ended')",
  )
    .bind(c.req.param('slug'))
    .first<ClaimGate>();
  if (!gate) return c.json({ error: 'Not found' }, 404);
  const ended =
    gate.archived_at || Date.parse(gate.ends_at) <= Date.now() || gate.gate_state === 'ended';
  const data = ended ? { state: 'ended' } : await getPublicCampaignStatus(c.env.DB, gate);
  const response = Response.json(data, { headers: { 'Cache-Control': 'public, max-age=20' } });
  if (cache) c.executionCtx.waitUntil(cache.put(key, response.clone()));
  response.headers.set('Cache-Control', 'public, max-age=15');
  return response;
});
publicCampaigns.get('/c/:slug/go', async (c) => {
  const gate = await load(c),
    code = (c.req.query('c') ?? '').toUpperCase();
  if (!gate || !gate.is_active || Date.parse(gate.ends_at) < Date.now())
    return c.text('キャンペーンは終了しました', 410);
  if (!/^[A-HJKMNP-Z2-9]{5}$/.test(code))
    return c.text('合言葉の参加ボタンから開いてください', 400);
  if (!(await publicRateLimit(c, 'gate-intent', 20, 200)))
    return c.text('時間をおいてお試しください', 429);
  // The code is public once posted. Never return friend details or code existence here.
  await c.env.DB.prepare(
    "INSERT INTO gate_events(id,gate_id,type,at) VALUES (?,?,'intent_opened',?)",
  )
    .bind(crypto.randomUUID(), gate.id, Date.now())
    .run();
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  return c.redirect(intentUrl(gate, code, /Android/i.test(c.req.header('User-Agent') ?? '')));
});
publicCampaigns.get('/c/:slug/og.png', async (c) => {
  const gate = await load(c);
  if (!gate) return c.text('Not found', 404);
  const cacheUrl = new URL(c.req.url);
  cacheUrl.search = '';
  const key = new Request(cacheUrl);
  const cache =
    typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : undefined;
  const cached = await cache?.match(key);
  if (cached) return cached;
  if (!(await publicRateLimit(c, 'gate-og', 10, 100))) return c.text('Try again later', 429);
  const totals = await c.env.DB.prepare(
    'SELECT SUM(CASE WHEN is_consolation=0 THEN MAX(0,quota-issued) ELSE 0 END) AS remaining,MAX(is_consolation) AS consolation,SUM(CASE WHEN quota IS NULL AND is_consolation=0 THEN 1 ELSE 0 END) AS unlimited FROM gate_rewards WHERE gate_id=?',
  )
    .bind(gate.id)
    .first<{ remaining: number | null; consolation: number; unlimited: number }>();
  const { renderGateOg } = await import('../services/gate-og.js');
  const png = await renderGateOg({
    remaining: totals?.unlimited ? null : (totals?.remaining ?? 0),
    consolation: !!totals?.consolation,
    endsAt: gate.ends_at,
  });
  const response = new Response(png as BodyInit, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
  if (cache) c.executionCtx.waitUntil(cache.put(key, response.clone()));
  return response;
});
export { publicCampaigns };
