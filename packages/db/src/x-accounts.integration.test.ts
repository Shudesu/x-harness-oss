import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { getXAccountById, updateXAccount } from './x-accounts.js';
import { compileMigrationForD1Exec } from './d1-test-utils.js';

describe('X account credential audit integration', () => {
  let miniflare: Miniflare;
  let db: D1Database;

  beforeEach(async () => {
    miniflare = new Miniflare({
      compatibilityDate: '2024-12-01',
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
      d1Databases: { DB: 'x-account-audit-integration-test' },
    });
    db = await miniflare.getD1Database('DB') as unknown as D1Database;
    await db.exec(compileMigrationForD1Exec(`
      CREATE TABLE x_accounts (
        id TEXT PRIMARY KEY,
        x_user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        display_name TEXT,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        consumer_key TEXT,
        consumer_secret TEXT,
        access_token_secret TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE cubelic_audit_logs (
        audit_id TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        before_json TEXT NOT NULL,
        after_json TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        correlation_id TEXT NOT NULL
      );
      INSERT INTO x_accounts (
        id, x_user_id, username, access_token, is_active, created_at, updated_at
      ) VALUES (
        'account_1', '1556917966587166720', 'tubelic_cube', 'old_app_token', 1,
        '2026-07-23T00:00:00.000Z', '2026-07-23T00:00:00.000Z'
      );
    `));
  });

  afterEach(async () => {
    await miniflare.dispose();
  });

  it('updates OAuth credentials and appends a secret-free audit in one batch', async () => {
    await updateXAccount(db, 'account_1', {
      accessToken: 'user_token',
      consumerKey: 'consumer_key',
      consumerSecret: 'consumer_secret',
      accessTokenSecret: 'access_token_secret',
    }, {
      actor: 'human',
      action: 'x_account.credentials_updated',
      entityType: 'x_account',
      entityId: 'account_1',
      before: { authMode: 'bearer', active: true },
      after: { authMode: 'oauth1_user_context', active: true },
      correlationId: 'corr_credentials_1',
    });

    await expect(getXAccountById(db, 'account_1')).resolves.toMatchObject({
      access_token: 'user_token',
      consumer_key: 'consumer_key',
      consumer_secret: 'consumer_secret',
      access_token_secret: 'access_token_secret',
    });
    const audit = await db.prepare(
      'SELECT action, before_json, after_json, correlation_id FROM cubelic_audit_logs',
    ).first<{
      action: string;
      before_json: string;
      after_json: string;
      correlation_id: string;
    }>();
    expect(audit).toEqual({
      action: 'x_account.credentials_updated',
      before_json: JSON.stringify({ authMode: 'bearer', active: true }),
      after_json: JSON.stringify({ authMode: 'oauth1_user_context', active: true }),
      correlation_id: 'corr_credentials_1',
    });
    expect(JSON.stringify(audit)).not.toContain('user_token');
    expect(JSON.stringify(audit)).not.toContain('consumer_secret');
    expect(JSON.stringify(audit)).not.toContain('access_token_secret');
  });
});
