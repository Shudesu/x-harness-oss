import { describe, expect, it, vi } from 'vitest';
import { Phase1XPublishingAdapter, Phase3XPublishingAdapter } from './adapter.js';

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

const approvedPublication = {
  draftId: 'drf_1',
  accountId: 'acc_1',
  text: '人間が確認した投稿',
  mediaAssetIds: [],
  category: 'event_notice' as const,
  templateId: 'event-notice-v1',
  approvalStatus: 'approved' as const,
  approvedBy: 'operator_1',
  approvedAt: '2026-07-23T01:00:00.000Z',
  rightsGate: 'not_applicable' as const,
  privacyReviewCompleted: true as const,
  linkValidated: true as const,
  idempotencyKey: 'publication-key',
};

describe('Phase3XPublishingAdapter', () => {
  it('publishes immediately only with individual human authorization', async () => {
    const publishWriter = vi.fn(async () => ({
      postId: 'post_1',
      status: 'published' as const,
      publishedAt: '2026-07-23T01:05:00.000Z',
    }));
    const adapter = new Phase3XPublishingAdapter({
      enabled: true,
      isEmergencyStopped: async () => false,
      checkRateLimit: async () => ({ allowed: true as const }),
      scheduleWriter: vi.fn(),
      publishWriter,
    });

    const result = await adapter.publishPost({
      ...approvedPublication,
      authorization: {
        kind: 'human_individual',
        operatorId: 'operator_1',
        authorizedAt: '2026-07-23T01:04:00.000Z',
      },
    });

    expect(result.status).toBe('published');
    expect(publishWriter).toHaveBeenCalledOnce();
  });

  it('schedules only an allowlisted pre-approved template', async () => {
    const scheduleWriter = vi.fn(async () => ({
      jobId: 'job_1',
      status: 'scheduled' as const,
      scheduledAt: '2026-07-24T01:00:00.000Z',
    }));
    const adapter = new Phase3XPublishingAdapter({
      enabled: true,
      allowedSchedulePolicies: [{ category: 'event_notice', templateId: 'event-notice-v1' }],
      isEmergencyStopped: async () => false,
      checkRateLimit: async () => ({ allowed: true as const }),
      scheduleWriter,
      publishWriter: vi.fn(),
      now: () => new Date('2026-07-23T01:00:00.000Z'),
    });

    const result = await adapter.schedulePost({
      ...approvedPublication,
      scheduledAt: '2026-07-24T01:00:00.000Z',
      authorization: {
        kind: 'preapproved_template',
        policyId: 'event-notice-v1',
        approvedBy: 'operator_1',
        approvedAt: '2026-07-23T00:00:00.000Z',
      },
    });

    expect(result.status).toBe('scheduled');
    expect(scheduleWriter).toHaveBeenCalledOnce();
  });

  it.each([
    ['capability disabled', { enabled: false }, 'phase3_operation_disabled'],
    ['emergency stop active', { isEmergencyStopped: async () => true }, 'emergency_stop_active'],
    ['rate limit denied', { checkRateLimit: async () => ({ allowed: false as const, reason: 'daily_limit' }) }, 'publication_rate_limited'],
  ])('fails closed when %s', async (_name, override, code) => {
    const adapter = new Phase3XPublishingAdapter({
      enabled: true,
      isEmergencyStopped: async () => false,
      checkRateLimit: async () => ({ allowed: true as const }),
      scheduleWriter: vi.fn(),
      publishWriter: vi.fn(async () => ({
        postId: 'post_1',
        status: 'published' as const,
        publishedAt: '2026-07-23T01:05:00.000Z',
      })),
      ...override,
    });

    await expect(adapter.publishPost({
      ...approvedPublication,
      authorization: {
        kind: 'human_individual',
        operatorId: 'operator_1',
        authorizedAt: '2026-07-23T01:04:00.000Z',
      },
    })).rejects.toMatchObject({ code });
  });

  it('rejects automation on the immediate-publication seam', async () => {
    const adapter = new Phase3XPublishingAdapter({
      enabled: true,
      isEmergencyStopped: async () => false,
      checkRateLimit: async () => ({ allowed: true as const }),
      scheduleWriter: vi.fn(),
      publishWriter: vi.fn(),
    });

    await expect(adapter.publishPost({
      ...approvedPublication,
      authorization: {
        kind: 'preapproved_template',
        policyId: 'event-notice-v1',
        approvedBy: 'operator_1',
        approvedAt: '2026-07-23T00:00:00.000Z',
      },
    })).rejects.toMatchObject({ code: 'human_publication_required' });
  });
});
