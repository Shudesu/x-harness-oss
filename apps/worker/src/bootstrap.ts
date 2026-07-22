import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { resolveCorsOrigin } from './cubelic/cors.js';

type BootstrapEnv = {
  Bindings: {
    DB: D1Database;
    API_KEY?: string;
    CORS_ALLOWED_ORIGINS?: string;
    CUBELIC_SAFE_MODE?: string;
    GLOBAL_PUBLISHING_DISABLED?: string;
  };
};

type AccountInput = {
  xUserId?: string;
  username?: string;
  displayName?: string;
  accessToken?: string;
};

const encoder = new TextEncoder();

async function secretsMatch(provided: string, expected: string): Promise<boolean> {
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function bootstrapSafetyIsActive(env: BootstrapEnv['Bindings']): Promise<boolean> {
  if (env.CUBELIC_SAFE_MODE !== 'true' || env.GLOBAL_PUBLISHING_DISABLED !== 'true') return false;
  const flag = await env.DB.prepare(
    "SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'",
  ).first<{ value: string }>();
  return flag?.value === 'true';
}

function serializeAccount(account: Record<string, unknown>) {
  return {
    id: account.id,
    xUserId: account.x_user_id,
    username: account.username,
    displayName: account.display_name,
    isActive: account.is_active === 1,
    createdAt: account.created_at,
  };
}

export function createBootstrapApp(): Hono<BootstrapEnv> {
  const app = new Hono<BootstrapEnv>();

  app.use('*', cors({
    origin: (origin, c) => resolveCorsOrigin(origin, c.env.CORS_ALLOWED_ORIGINS),
    allowHeaders: ['Authorization', 'Content-Type', 'X-Correlation-Id'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    maxAge: 600,
  }));

  app.get('/api/health', async (c) => {
    const safetyActive = await bootstrapSafetyIsActive(c.env).catch(() => false);
    return c.json({
      success: safetyActive,
      data: {
        status: safetyActive ? 'safe-disabled' : 'misconfigured',
        mode: 'production-account-bootstrap',
        publishingEnabled: false,
        schedulingEnabled: false,
      },
    }, safetyActive ? 200 : 503);
  });

  app.use('/api/*', async (c, next) => {
    if (!c.env.API_KEY) return c.json({ success: false, error: 'Authentication unavailable' }, 503);
    const authorization = c.req.header('Authorization');
    if (!authorization?.startsWith('Bearer ')) return c.json({ success: false, error: 'Unauthorized' }, 401);
    if (!await secretsMatch(authorization.slice('Bearer '.length), c.env.API_KEY)) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    if (!await bootstrapSafetyIsActive(c.env).catch(() => false)) {
      return c.json({ success: false, error: 'Bootstrap safety controls are unavailable' }, 503);
    }
    return next();
  });

  app.get('/api/session', (c) => c.json({
    success: true,
    data: { authenticated: true, role: 'admin', name: 'Bootstrap Operator' },
  }));

  app.get('/api/x-accounts', async (c) => {
    const result = await c.env.DB.prepare(
      'SELECT id, x_user_id, username, display_name, is_active, created_at FROM x_accounts ORDER BY created_at',
    ).all<Record<string, unknown>>();
    return c.json({
      success: true,
      data: result.results.map(serializeAccount),
      polling: { activeGates: 0, totalApiCalls: 0, estimatedTotalCost: '$0.00', gates: [] },
    });
  });

  app.post('/api/x-accounts', async (c) => {
    const contentLength = Number(c.req.header('Content-Length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > 16_384) {
      return c.json({ success: false, error: 'Request body too large' }, 413);
    }

    const body = await c.req.json<AccountInput>().catch(() => null);
    const xUserId = body?.xUserId?.trim();
    const username = body?.username?.trim().replace(/^@/, '');
    const accessToken = body?.accessToken?.trim();
    if (!xUserId || !username || !accessToken) {
      return c.json({ success: false, error: 'Missing required fields' }, 400);
    }
    if (xUserId.length > 64 || username.length > 64 || accessToken.length > 8_192) {
      return c.json({ success: false, error: 'Invalid field length' }, 400);
    }

    const existing = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM x_accounts').first<{ count: number }>();
    if ((existing?.count ?? 0) > 0) {
      return c.json({ success: false, error: 'Production account is already configured' }, 409);
    }

    const accountId = crypto.randomUUID();
    const auditId = crypto.randomUUID();
    const correlationId = c.req.header('X-Correlation-Id') ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const accountStatement = c.env.DB.prepare(
      `INSERT INTO x_accounts
       (id, x_user_id, username, display_name, access_token, refresh_token, consumer_key, consumer_secret, access_token_secret, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM x_accounts)`,
    ).bind(
      accountId,
      xUserId,
      username,
      body?.displayName?.trim() || null,
      accessToken,
      null,
      null,
      null,
      null,
      now,
      now,
    );
    const auditStatement = c.env.DB.prepare(
      `INSERT INTO cubelic_audit_logs
       (audit_id, actor, action, entity_type, entity_id, before_json, after_json, timestamp, correlation_id)
       SELECT ?, 'human', 'production_account_bootstrap', 'x_account', ?, '{}', ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM x_accounts WHERE id = ?)`,
    ).bind(
      auditId,
      accountId,
      JSON.stringify({
        is_active: true,
        credential_fields_present: { access_token: true },
      }),
      now,
      correlationId,
      accountId,
    );
    const results = await c.env.DB.batch([accountStatement, auditStatement]);
    if ((results[0]?.meta.changes ?? 0) !== 1) {
      return c.json({ success: false, error: 'Production account is already configured' }, 409);
    }

    return c.json({
      success: true,
      data: { id: accountId, xUserId, username, displayName: body?.displayName?.trim() || null, isActive: true, createdAt: now },
    }, 201);
  });

  app.onError((error, c) => {
    console.error(JSON.stringify({ event: 'bootstrap_request_failed', error: error.name }));
    return c.json({ success: false, error: 'Internal Server Error' }, 500);
  });

  return app;
}

export default createBootstrapApp();
