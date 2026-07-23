import { Hono } from 'hono';
import type { Env } from '../index.js';

export const HARNESS_VERSION = '0.5.1';
export const CONNECTOR_VERSION = '2026-05-20';

export const FEATURES = [
  'engagement-gates',
  'reply-trigger',
  'scheduled-posts',
  'step-sequences',
  'dm',
  'campaigns',
  'line-cross-link',
  'followers',
  'tags',
  'usage',
  'multi-account',
  'setup',
] as const;

export const capabilities = new Hono<Env>();

capabilities.get('/api/capabilities', (c) => {
  const safeMode = true;
  const publishingDisabled = true;
  return c.json({
    success: true,
    data: {
      product: 'x-harness',
      platform: 'x',
      version: HARNESS_VERSION,
      connectorVersion: CONNECTOR_VERSION,
      identity: {
        primaryKey: 'x_user_id',
        supportedLinks: ['line_friend_id'],
      },
      features: publishingDisabled
        ? ['cubelic-inert-drafts', 'cubelic-human-approval', 'cubelic-rights-gate', 'cubelic-metrics', 'multi-account']
        : FEATURES,
      safety: {
        cubelicSafeMode: safeMode,
        globalPublishingDisabled: c.env.GLOBAL_PUBLISHING_DISABLED !== 'false',
        immediatePublishing: !publishingDisabled,
        scheduling: !publishingDisabled,
        dm: !publishingDisabled,
        automatedEngagement: !publishingDisabled,
        cookieScraping: !publishingDisabled,
      },
      endpoints: {
        health: '/api/health',
        xAccounts: '/api/x-accounts',
        cubelicDrafts: '/api/cubelic/drafts',
        cubelicInertDraft: '/api/cubelic/x-harness-inbox/:draftId',
      },
    },
  });
});
