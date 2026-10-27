import type { Env } from '../index.js';
import { pollClaimGate } from '../services/claim-poller.js';
export class GateClaimCoordinator {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private ctx: DurableObjectState,
    private env: Env['Bindings'],
  ) {}
  private run(gateId: string) {
    const task = this.tail
      .catch(() => {})
      .then(async () => {
        const result = await pollClaimGate(this.env, gateId);
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
    const body = (await request.json()) as { gateId?: string };
    if (request.method !== 'POST' || !body.gateId || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.gateId))
      return new Response('Invalid request', { status: 400 });
    await this.ctx.storage.put('gateId', body.gateId);
    try {
      return Response.json(await this.run(body.gateId));
    } catch {
      await this.ctx.storage.setAlarm(Date.now() + 60000);
      return Response.json({ pending: 1, retryAfterSec: 60 }, { status: 503 });
    }
  }
  async alarm() {
    const gateId = await this.ctx.storage.get<string>('gateId');
    if (!gateId) return;
    try {
      await this.run(gateId);
    } catch {
      await this.ctx.storage.setAlarm(Date.now() + 60000);
    }
  }
}
