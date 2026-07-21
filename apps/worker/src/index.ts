import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authMiddleware } from './middleware/auth.js';
import { health } from './routes/health.js';
import { engagementGates } from './routes/engagement-gates.js';
import { followers } from './routes/followers.js';
import { tags } from './routes/tags.js';
import { posts } from './routes/posts.js';
import { users } from './routes/users.js';
import { xAccounts } from './routes/x-accounts.js';
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
import { cubelic } from './routes/cubelic.js';
import { cubelicLegacyWriteGuard } from './cubelic/safety.js';
import { resolveCorsOrigin } from './cubelic/cors.js';
import type { CubelicXAdapterFactory } from './cubelic/adapter.js';

export type Env = {
  Bindings: {
    DB: D1Database;
    API_KEY: string;
    X_ACCESS_TOKEN: string;
    X_REFRESH_TOKEN: string;
    WORKER_URL: string;
    LINE_HARNESS_URL?: string;
    LINE_HARNESS_API_KEY?: string;
    USER_SEARCH_DAILY_LIMIT?: string;
    VERIFY_LOOKUP_DAILY_LIMIT?: string;
    GROWTH_IMAGES?: R2Bucket;
    CUBELIC_SAFE_MODE?: string;
    GLOBAL_PUBLISHING_DISABLED?: string;
    HUMAN_APPROVAL_KEY?: string;
    HERMES_ACCESS_TOKEN?: string;
    X_HARNESS_ACCOUNT_ID?: string;
    CORS_ALLOWED_ORIGINS?: string;
  };
  Variables: {
    staffRole?: 'admin' | 'editor' | 'viewer';
    staffId?: string;
    staffName?: string;
    requestActor?: 'human' | 'hermes';
    cubelicAdapterFactory?: CubelicXAdapterFactory;
    correlationId?: string;
  };
};

const app = new Hono<Env>();

app.use('*', cors({
  origin: (origin, c) => resolveCorsOrigin(origin, (c.env as Env['Bindings']).CORS_ALLOWED_ORIGINS),
  allowHeaders: ['Authorization', 'Content-Type', 'X-Correlation-Id', 'X-Human-Approval-Key'],
  allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  maxAge: 600,
}));
app.use('*', authMiddleware);
app.use('*', cubelicLegacyWriteGuard);

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
app.route('/', cubelic);

// Settings API (key-value store)
app.get('/api/settings', async (c) => {
  const rows = await c.env.DB.prepare('SELECT key, value, updated_at FROM settings').all<{ key: string; value: string; updated_at: string }>();
  const settings: Record<string, string> = {};
  for (const r of rows.results) settings[r.key] = r.value;
  return c.json({ success: true, data: settings });
});

app.put('/api/settings', async (c) => {
  const body = await c.req.json<Record<string, string>>();
  const now = new Date().toISOString();
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
  return c.json({ success: true, data: row });
});

app.post('/api/line-connections', async (c) => {
  const body = await c.req.json<{ name: string; workerUrl: string; apiKey: string }>();
  if (!body.name || !body.workerUrl || !body.apiKey) return c.json({ success: false, error: 'name, workerUrl, apiKey required' }, 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO line_connections (id, name, worker_url, api_key, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))').bind(id, body.name, body.workerUrl.replace(/\/$/, ''), body.apiKey).run();
  return c.json({ success: true, data: { id, name: body.name, workerUrl: body.workerUrl } }, 201);
});

app.delete('/api/line-connections/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM line_connections WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ success: true });
});

app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404));

async function scheduled(
  _event: ScheduledEvent,
  _env: Env['Bindings'],
  _ctx: ExecutionContext,
): Promise<void> {
  // Phase 1 has no continuous X polling. Read-only metric collection is
  // initiated explicitly through XPublishingAdapter after a post mapping.
}

export default {
  fetch: app.fetch,
  scheduled,
};
