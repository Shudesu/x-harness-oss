import { oauth } from './routes/oauth.js';
import { maintenance } from './routes/maintenance.js';
import { ai } from './routes/ai.js';
import { runAiFeature } from './services/ai-features.js';
import { buildXClient } from './services/x-client.js';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getXAccounts, hasSnapshotForToday, recordSnapshot } from '@x-harness/db';
import { authenticate, createSession } from './services/session.js';
import { publicRateLimit } from './services/rate-limit.js';
import { encryptSecret, decryptSecret } from '@x-harness/db';
import { authMiddleware, isPublicPath } from './middleware/auth.js';
import { health } from './routes/health.js';
import { engagementGates } from './routes/engagement-gates.js';
import { followers } from './routes/followers.js';
import { tags } from './routes/tags.js';
import { posts } from './routes/posts.js';
import { users } from './routes/users.js';
import { xAccounts } from './routes/x-accounts.js';
import { processEngagementGates } from './services/engagement-gate.js';
import { processScheduledPosts } from './services/post-scheduler.js';
import { EngagementCache } from './services/reply-trigger-cache.js';
import { stepSequences } from './routes/step-sequences.js';
import { verify } from './routes/verify.js';
import { staff } from './routes/staff.js';
import { dm } from './routes/dm.js';
import { usage } from './routes/usage.js';
import { xaa } from './routes/xaa.js';
import { campaigns } from './routes/campaigns.js';
import { setup } from './routes/setup.js';
import { capabilities } from './routes/capabilities.js';
import { articles } from './routes/articles.js';
import { growth } from './routes/growth.js';
import { growthSources } from './routes/growth-sources.js';
import { growthArticles } from './routes/growth-articles.js';
import { processStepSequences } from './services/step-processor.js';

export type Env = {
  Bindings: {
    DB: D1Database;
    API_KEY: string;
    X_OAUTH_CLIENT_ID?: string;
    X_OAUTH_CLIENT_SECRET?: string;
    ENCRYPTION_KEY?: string;
    ADMIN_ORIGIN?: string;
    VERIFY_NEGATIVE_TTL_MS?: string;
    XAI_API_KEY?: string;
    XAI_MODEL?: string;
    XAI_MONTHLY_BUDGET_USD?: string;
    WORKER_URL: string;
    LINE_HARNESS_URL?: string;
    LINE_HARNESS_API_KEY?: string;
    USER_SEARCH_DAILY_LIMIT?: string;
    VERIFY_LOOKUP_DAILY_LIMIT?: string;
    GROWTH_IMAGES?: R2Bucket;
  };
  Variables: {
    staffRole?: 'admin' | 'editor' | 'viewer';
    staffId?: string;
    staffName?: string;
  };
};

const app = new Hono<Env>();

app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  return cors({origin: (origin) => {
    if (isPublicPath(c.req.path) && c.req.path !== '/api/auth/session') return '*';
    const allowed = (c.env.ADMIN_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    if (c.env.WORKER_URL) allowed.push(new URL(c.env.WORKER_URL).origin);
    return allowed.includes(origin) ? origin : undefined;
  }})(c,next);
});
app.use('*', authMiddleware);

app.post('/api/auth/session', async c => {
  if (!await publicRateLimit(c,'login',5,50)) return c.json({success:false,error:'Too many attempts'},429);
  const body = await c.req.json<{apiKey?:string}>();
  if (typeof body.apiKey !== 'string' || body.apiKey.startsWith('xhs.')) return c.json({success:false,error:'Invalid key'},401);
  const identity = await authenticate(c.env,body.apiKey);
  if (!identity) return c.json({success:false,error:'Unauthorized'},401);
  c.header('Cache-Control','no-store');
  return c.json({success:true,data:await createSession(c.env,identity)});
});
app.route('/', oauth);
app.route('/', maintenance);
app.route('/', ai);
app.route('/', health);
app.route('/', verify);
app.route('/', engagementGates);
app.route('/', followers);
app.route('/', tags);
app.route('/', posts);
app.route('/', users);
app.route('/', xAccounts);
app.route('/', stepSequences);
app.route('/', staff);
app.route('/', dm);
app.route('/', usage);
app.route('/', xaa);
app.route('/', campaigns);
app.route('/', setup);
app.route('/', capabilities);
app.route('/', articles);
app.route('/', growth);
app.route('/', growthSources);
app.route('/', growthArticles);

// Settings API (key-value store)
app.get('/api/settings', async (c) => {
  const rows = await c.env.DB.prepare('SELECT key, value, updated_at FROM settings').all<{ key: string; value: string; updated_at: string }>();
  const settings: Record<string, string> = {};
  for (const r of rows.results) settings[r.key] = r.value;
  return c.json({ success: true, data: settings });
});

app.put('/api/settings', async (c) => {
  const body = await c.req.json<Record<string, string>>();
  if(!body || typeof body!=='object' || Array.isArray(body))return c.json({success:false,error:'Invalid settings'},400);
  if(body.x_unit_prices){try{const prices=JSON.parse(body.x_unit_prices);if(!prices||typeof prices!=='object'||Array.isArray(prices)||Object.values(prices).some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0))throw new Error();}catch{return c.json({success:false,error:'Invalid unit prices'},400);}}
  if(body.xai_model && !['grok-4.3','grok-4.7'].includes(body.xai_model))return c.json({success:false,error:'Invalid AI model'},400);
  const now = new Date().toISOString();
  const allowed = new Set(['auto_features_enabled','x_monthly_budget_usd','scheduled_posts_ignore_budget','x_unit_prices','x_owned_reads','xai_model','xai_monthly_budget_usd','ai_watch_handles','ai_keywords','ai_digest_enabled']);
  if (Object.entries(body).some(([k,v]) => !allowed.has(k) || typeof v !== 'string' || v.length > 4000)) return c.json({success:false,error:'Invalid settings'},400);
  for (const k of ['x_monthly_budget_usd','xai_monthly_budget_usd']) if (body[k] !== undefined && (!Number.isFinite(Number(body[k])) || Number(body[k]) < 0)) return c.json({success:false,error:'Invalid budget'},400);
  for (const [key, value] of Object.entries(body)) {
    await c.env.DB.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?')
      .bind(key, value, now, value, now).run();
  }
  return c.json({ success: true });
});

// LINE Connections API
app.get('/api/line-connections', async (c) => {
  const rows = await c.env.DB.prepare('SELECT id, name, worker_url, created_at FROM line_connections ORDER BY created_at DESC').all<{ id: string; name: string; worker_url: string; created_at: string }>();
  return c.json({ success: true, data: rows.results });
});

app.get('/api/line-connections/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM line_connections WHERE id = ?').bind(c.req.param('id')).first<{ id: string; name: string; worker_url: string; api_key: string; created_at: string }>();
  if (!row) return c.json({ success: false, error: 'Not found' }, 404);
  const {api_key, ...safe} = row;
  return c.json({ success: true, data: {...safe, hasApiKey: !!api_key} });
});

app.post('/api/line-connections', async (c) => {
  const body = await c.req.json<{ name: string; workerUrl: string; apiKey: string }>();
  if (!body.name || !body.workerUrl || !body.apiKey) return c.json({ success: false, error: 'name, workerUrl, apiKey required' }, 400);
  let target: URL; try { target = new URL(body.workerUrl); } catch { return c.json({success:false,error:'Invalid URL'},400); }
  if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash) return c.json({success:false,error:'HTTPS URL required'},400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO line_connections (id, name, worker_url, api_key, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))').bind(id, body.name, body.workerUrl.replace(/\/$/, ''), await encryptSecret(body.apiKey, c.env.ENCRYPTION_KEY)).run();
  return c.json({ success: true, data: { id, name: body.name, workerUrl: body.workerUrl } }, 201);
});

app.delete('/api/line-connections/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM line_connections WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ success: true });
});


app.all('/api/line-connections/:id/proxy/:resource', async c => {
  const resource = c.req.param('resource');
  if (!['tags','forms','friends','scenarios','message-templates','traffic-pools','tracked-links'].includes(resource)) return c.json({success:false,error:'Not found'},404);
  if (!['GET','POST'].includes(c.req.method)) return c.json({success:false,error:'Method not allowed'},405);
  const row = await c.env.DB.prepare('SELECT worker_url, api_key FROM line_connections WHERE id = ?').bind(c.req.param('id')).first<{worker_url:string;api_key:string}>();
  if (!row) return c.json({success:false,error:'Not found'},404);
  const url = new URL(`${row.worker_url.replace(/\/$/,'')}/api/${resource}`);
  if (url.protocol !== 'https:') return c.json({success:false,error:'HTTPS required'},400);
  url.search = new URL(c.req.url).search;
  const response = await fetch(url,{method:c.req.method,redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${await decryptSecret(row.api_key,c.env.ENCRYPTION_KEY)}`},...(c.req.method === 'POST' ? {body:await c.req.text()} : {}),signal:AbortSignal.timeout(15000)});
  return new Response(await response.text(),{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
});

app.onError((err,c)=> { console.error('Request failed',err.name); return c.json({success:false,error:err.name === 'BudgetExceededError' ? 'X API budget reached' : 'Request failed'},err.name === 'BudgetExceededError' ? 429 : 500); });

app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404));

async function getSettingBool(db: D1Database, key: string, defaultValue = false): Promise<boolean> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  if (!row) return defaultValue;
  return row.value === 'true' || row.value === '1';
}

async function scheduled(
  _event: ScheduledEvent,
  env: Env['Bindings'],
  _ctx: ExecutionContext,
): Promise<void> {
  // Auto-features are OFF by default to avoid unexpected API costs.
  // Users enable them from the dashboard settings page.
  const autoEnabled = await getSettingBool(env.DB, 'auto_features_enabled', false);

  const dbAccounts = await getXAccounts(env.DB);

  for (const account of dbAccounts) {
    try {
      // Explicitly scheduled posts are independent of optional auto discovery.
      await processScheduledPosts(env.DB,await buildXClient(env,account,'scheduled'),account.id);
      if(autoEnabled) await processEngagementGates(env.DB,await buildXClient(env,account,'gate'),account.id,false,new EngagementCache(undefined,env.DB),env.ENCRYPTION_KEY);
      if(!await hasSnapshotForToday(env.DB,account.id)) {
        const client=await buildXClient(env,account,'snapshot');const me=await client.getMe();
        if(me.public_metrics) await recordSnapshot(env.DB,{xAccountId:account.id,followersCount:me.public_metrics.followers_count,followingCount:me.public_metrics.following_count,tweetCount:me.public_metrics.tweet_count});
      }
      const tick=new Date(_event.scheduledTime);const day=new Date(_event.scheduledTime+9*3600000).toISOString().slice(0,10);
      if(tick.getUTCHours()===23 && await getSettingBool(env.DB,'ai_digest_enabled',false)) {
        const exists=await env.DB.prepare("SELECT id FROM ai_outputs WHERE x_account_id=? AND feature='digest' AND ref_id=?").bind(account.id,day).first();
        if(!exists) await runAiFeature(env,account.id,'digest');
      }
    } catch(err) { console.error('Account scheduled job failed',account.id,err instanceof Error?err.name:'error'); }
  }
  if(autoEnabled) await processStepSequences(env.DB,async id=>{const a=dbAccounts.find(a=>a.id===id);return a?buildXClient(env,a,'step'):null;});
  await env.DB.prepare('DELETE FROM rate_counters WHERE window_start < ?').bind(Date.now()-2*86400000).run();
  await env.DB.prepare('DELETE FROM user_search_cache WHERE fetched_at < ?').bind(Date.now()-86400000).run();

}

export default {
  fetch: app.fetch,
  scheduled,
};
