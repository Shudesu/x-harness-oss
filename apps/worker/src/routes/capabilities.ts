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
      features: FEATURES,
      endpoints: {
        health: '/api/health',
        staffMe: '/api/staff/me',
        xAccounts: '/api/x-accounts',
        engagementGates: '/api/engagement-gates',
        engagementVerify: '/api/engagement-gates/:id/verify',
        lineConnections: '/api/line-connections',
        lineCampaignConfig: '/api/campaigns/line-config',
        dmConversations: '/api/dm/conversations',
        campaigns: '/api/campaigns',
        setupStatus: '/setup',
      },
    },
  });
});
