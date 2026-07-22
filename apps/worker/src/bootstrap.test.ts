import { describe, expect, it } from 'vitest';
import { createBootstrapApp } from './bootstrap.js';

function bindings(overrides: Record<string, unknown> = {}, accountInsertChanges = 1) {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      const statement = {
        sql,
        values: [] as unknown[],
        bind(...values: unknown[]) {
          statement.values = values;
          statements.push(statement);
          return statement;
        },
        async first() {
          if (sql.includes('cubelic_system_flags')) return { value: 'true' };
          return { count: 0 };
        },
        async all() {
          return { results: [] };
        },
      };
      return statement;
    },
    async batch(batchStatements: unknown[]) {
      expect(batchStatements).toHaveLength(2);
      return [{ meta: { changes: accountInsertChanges } }, { meta: { changes: accountInsertChanges } }];
    },
  } as unknown as D1Database;
  return {
    env: {
      DB: db,
      API_KEY: 'bootstrap-management-key',
      CORS_ALLOWED_ORIGINS: 'https://bootstrap.example.test',
      CUBELIC_SAFE_MODE: 'true',
      GLOBAL_PUBLISHING_DISABLED: 'true',
      ...overrides,
    },
    statements,
  };
}

describe('production account bootstrap Worker', () => {
  it('exposes only a publishing-disabled health response without authentication', async () => {
    const { env } = bindings();
    const response = await createBootstrapApp().request('/api/health', undefined, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { mode: 'production-account-bootstrap', publishingEnabled: false, schedulingEnabled: false },
    });
  });

  it('rejects missing and incorrect management credentials', async () => {
    const { env } = bindings();
    const missing = await createBootstrapApp().request('/api/session', undefined, env);
    const incorrect = await createBootstrapApp().request('/api/session', {
      headers: { Authorization: 'Bearer incorrect' },
    }, env);

    expect(missing.status).toBe(401);
    expect(incorrect.status).toBe(401);
  });

  it('fails closed when the publishing-disable controls are not all active', async () => {
    const { env, statements } = bindings({ GLOBAL_PUBLISHING_DISABLED: 'false' });
    const response = await createBootstrapApp().request('/api/x-accounts', {
      method: 'POST',
      headers: { Authorization: 'Bearer bootstrap-management-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ xUserId: '12345', username: 'cubelic', accessToken: 'secret-x-token' }),
    }, env);

    expect(response.status).toBe(503);
    expect(statements).toHaveLength(0);
  });

  it('stores one account and a redacted audit event in the same D1 batch', async () => {
    const { env, statements } = bindings();
    const response = await createBootstrapApp().request('/api/x-accounts', {
      method: 'POST',
      headers: { Authorization: 'Bearer bootstrap-management-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ xUserId: '12345', username: '@cubelic', accessToken: 'secret-x-token' }),
    }, env);

    expect(response.status).toBe(201);
    expect(statements).toHaveLength(2);
    const auditValues = statements[1].values.join(' ');
    expect(auditValues).not.toContain('secret-x-token');
    expect(auditValues).not.toContain('cubelic');
  });

  it('reports a conflict if a concurrent request wins the single-account insert', async () => {
    const { env } = bindings({}, 0);
    const response = await createBootstrapApp().request('/api/x-accounts', {
      method: 'POST',
      headers: { Authorization: 'Bearer bootstrap-management-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ xUserId: '12345', username: 'cubelic', accessToken: 'secret-x-token' }),
    }, env);

    expect(response.status).toBe(409);
  });
});
