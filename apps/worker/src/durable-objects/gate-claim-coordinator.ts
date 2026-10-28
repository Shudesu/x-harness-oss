import { readExternalSource } from '../services/external-source.js';
import { pollAccountGates } from '../services/claim-batch-poller.js';
import type { Env } from '../index.js';
import { pollClaimGate } from '../services/claim-poller.js';
export class GateClaimCoordinator {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private ctx: DurableObjectState,
    private env: Env['Bindings'],
  ) {}
  private run(gateId: string, xAccountId?: string, interactive = false) {
    const task = this.tail
      .catch(() => {})
      .then(async () => {
        if (
          !xAccountId && !(await readExternalSource(this.env.DB,gateId))?.enabled &&
          (
            await this.env.DB.prepare(
              "SELECT value FROM settings WHERE key='claim_batch_search'",
            ).first<{ value: string }>()
          )?.value === 'true'
        ) {
          const gate = await this.env.DB.prepare(
            'SELECT x_account_id,tier FROM engagement_gates WHERE id=?',
          )
            .bind(gateId)
            .first<{ x_account_id: string; tier: string }>();
          if (gate?.tier !== 'simple') xAccountId = gate?.x_account_id;
        }
        const result = xAccountId
          ? await pollAccountGates(this.env, xAccountId, Date.now(), interactive)
          : await pollClaimGate(this.env, gateId, Date.now(), { interactive });
        if (result.pending)
          await this.ctx.storage.setAlarm(
            Date.now() + Math.max(10000, result.retryAfterSec * 1000),
          );
        else await this.ctx.storage.deleteAlarm();
        return result;
      });
    this.tail = task;
    return task;
  }
  async fetch(request: Request) {
    const body = (await request.json()) as {
      gateId?: string;
      xAccountId?: string;
      interactive?: boolean;
    };
    if (
      request.method !== 'POST' ||
      !(body.gateId || body.xAccountId) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(body.gateId ?? body.xAccountId ?? '')
    )
      return new Response('Invalid request', { status: 400 });
    await this.ctx.storage.put('gateId', body.gateId ?? '');
    await this.ctx.storage.put('xAccountId', body.xAccountId ?? '');
    try {
      return Response.json(
        await this.run(body.gateId ?? '', body.xAccountId, body.interactive === true),
      );
    } catch {
      await this.ctx.storage.setAlarm(Date.now() + 60000);
      return Response.json({ pending: 1, retryAfterSec: 60 }, { status: 503 });
    }
  }
  async alarm() {
    const gateId = await this.ctx.storage.get<string>('gateId');
    const accountId = await this.ctx.storage.get<string>('xAccountId');
    if (!gateId && !accountId) return;
    try {
      await this.run(gateId ?? '', accountId || undefined);
    } catch {
      await this.ctx.storage.setAlarm(Date.now() + 60000);
    }
  }
}
