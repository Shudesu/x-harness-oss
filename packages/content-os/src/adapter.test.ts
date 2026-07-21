import { describe, expect, it, vi } from 'vitest';
import { Phase1XPublishingAdapter } from './adapter.js';

describe('Phase1XPublishingAdapter', () => {
  it('creates only an inert draft', async () => {
    const writer = vi.fn(async () => ({ inboxId: 'inbox_1', status: 'inert_draft' as const, idempotentReplay: false }));
    const adapter = new Phase1XPublishingAdapter(writer);
    const result = await adapter.createDraft({
      draftId: 'drf_1', accountId: 'acc_1', text: 'draft', mediaAssetIds: [], idempotencyKey: 'key', approvedBy: 'human', approvedAt: new Date().toISOString(),
    });
    expect(result.status).toBe('inert_draft');
    expect(writer).toHaveBeenCalledOnce();
  });

  it('disables schedule, publish and delete', async () => {
    const adapter = new Phase1XPublishingAdapter(async () => ({ inboxId: 'x', status: 'inert_draft', idempotentReplay: false }));
    await expect(adapter.schedulePost()).rejects.toMatchObject({ code: 'phase1_operation_disabled' });
    await expect(adapter.publishPost()).rejects.toMatchObject({ code: 'phase1_operation_disabled' });
    await expect(adapter.deletePost()).rejects.toMatchObject({ code: 'phase1_operation_disabled' });
  });

  it('preserves unavailable metrics as null', async () => {
    const adapter = new Phase1XPublishingAdapter(async () => ({ inboxId: 'x', status: 'inert_draft', idempotentReplay: false }));
    expect(await adapter.getMetrics('post_1')).toMatchObject({ impressions: null, ticket_clicks: null });
  });
});
