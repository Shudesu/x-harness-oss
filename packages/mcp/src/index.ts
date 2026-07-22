#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { XHarnessClient } from './client.js';
import { postToolDefs } from './tools/posts.js';
import { engagementToolDefs } from './tools/engagement.js';
import { userToolDefs } from './tools/users.js';
import { dmToolDefs } from './tools/dm.js';
import { gateToolDefs } from './tools/gates.js';
import { stepToolDefs } from './tools/steps.js';
import { analyticsToolDefs } from './tools/analytics.js';
import { staffToolDefs } from './tools/staff.js';
import { campaignToolDefs } from './tools/campaign.js';
import { usageToolDefs } from './tools/usage.js';
import { articleToolDefs } from './tools/articles.js';
import { scrapeToolDefs } from './tools/scrape.js';
import { growthToolDefs } from './tools/growth.js';
import { scrapeUserPosts, scrapeSearch, scrapeUser, scrapePost } from './scraper.js';

const API_URL = process.env.X_HARNESS_API_URL ?? 'http://localhost:8787';
const API_KEY = process.env.X_HARNESS_API_KEY ?? '';

const client = new XHarnessClient(API_URL, API_KEY);

const allTools = [
  ...postToolDefs,
  ...engagementToolDefs,
  ...userToolDefs,
  ...dmToolDefs,
  ...gateToolDefs,
  ...stepToolDefs,
  ...analyticsToolDefs,
  ...staffToolDefs,
  ...campaignToolDefs,
  ...usageToolDefs,
  ...articleToolDefs,
  ...scrapeToolDefs,
  ...growthToolDefs,
];

const pkgVersion: string = createRequire(import.meta.url)('../package.json').version;

const server = new Server({ name: 'x-harness', version: pkgVersion }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: allTools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, any>;
  try {
    let result: any;
    switch (name) {
      case 'create_post':
        result = await client.post('/api/posts', {
          xAccountId: a.xAccountId,
          text: a.text,
          ...(a.replyToTweetId ? { replyToTweetId: a.replyToTweetId } : {}),
          ...(a.quoteTweetId ? { quoteTweetId: a.quoteTweetId } : {}),
          ...(a.mediaIds ? { mediaIds: a.mediaIds } : {}),
          ...(a.paidPartnership ? { paidPartnership: true } : {}),
        });
        break;
      case 'create_article':
        result = await client.post('/api/articles/draft', {
          xAccountId: a.xAccountId,
          title: a.title,
          body: a.body,
          ...(a.coverMediaId ? { coverMediaId: a.coverMediaId } : {}),
        });
        break;
      case 'publish_article':
        result = await client.post(`/api/articles/${encodeURIComponent(a.articleId)}/publish`, { xAccountId: a.xAccountId });
        break;
      case 'search_news':
        result = await client.get(`/api/news/search?query=${encodeURIComponent(a.query)}${a.maxResults ? `&maxResults=${a.maxResults}` : ''}${a.xAccountId ? `&xAccountId=${encodeURIComponent(a.xAccountId)}` : ''}`);
        break;
      case 'get_news':
        result = await client.get(`/api/news/${encodeURIComponent(a.newsId)}${a.xAccountId ? `?xAccountId=${encodeURIComponent(a.xAccountId)}` : ''}`);
        break;
      case 'get_activity_events':
        result = await client.get(`/api/xaa/events?${a.eventType ? `eventType=${encodeURIComponent(a.eventType)}&` : ''}${a.limit ? `limit=${a.limit}` : ''}`);
        break;
      case 'create_thread':
        result = await client.post('/api/posts/thread', { xAccountId: a.xAccountId, texts: a.texts });
        break;
      case 'get_post_history':
        result = await client.get(`/api/posts/history?xAccountId=${encodeURIComponent(a.xAccountId)}${a.limit ? `&limit=${a.limit}` : ''}`);
        break;
      case 'get_mentions':
        result = await client.get(`/api/posts/mentions?xAccountId=${encodeURIComponent(a.xAccountId)}${a.sinceId ? `&sinceId=${encodeURIComponent(a.sinceId)}` : ''}`);
        break;
      case 'reply_to_post':
        result = await client.post(`/api/posts/${a.tweetId}/reply`, {
          xAccountId: a.xAccountId,
          text: a.text,
        });
        break;
      case 'delete_post':
        result = await client.del(`/api/posts/${a.tweetId}?xAccountId=${encodeURIComponent(a.xAccountId)}`);
        break;
      case 'get_post':
        result = await client.get(`/api/posts/${a.tweetId}`);
        break;
      case 'search_posts':
        result = await client.get(`/api/posts/search?query=${encodeURIComponent(a.query)}`);
        break;
      case 'schedule_post':
        result = await client.post('/api/posts/schedule', a);
        break;
      case 'like_post':
      case 'unlike_post':
      case 'retweet':
      case 'unretweet':
      case 'bookmark':
      case 'remove_bookmark':
      case 'follow':
      case 'unfollow':
        result = await client.post(`/api/engagement/${name}`, a);
        break;
      case 'get_user':
        result = await client.get(`/api/users/lookup?${a.username ? `username=${a.username}` : `userId=${a.userId}`}`);
        break;
      case 'search_users':
        result = await client.get(`/api/users/search?query=${encodeURIComponent(a.query)}`);
        break;
      case 'get_followers':
        result = await client.get(`/api/followers?xAccountId=${a.xAccountId}`);
        break;
      case 'get_following':
        result = await client.get(`/api/followers/following?xAccountId=${a.xAccountId}`);
        break;
      case 'send_dm':
        result = await client.post('/api/dm/send', {
          xAccountId: a.xAccountId,
          participantId: a.participantId,
          text: a.text,
        });
        break;
      case 'get_dm_conversations':
        result = await client.get(`/api/dm/conversations${a.xAccountId ? `?xAccountId=${encodeURIComponent(a.xAccountId)}` : ''}`);
        break;
      case 'get_dm_messages':
        result = await client.get(`/api/dm/conversations/${encodeURIComponent(a.conversationId)}/messages${a.xAccountId ? `?xAccountId=${encodeURIComponent(a.xAccountId)}` : ''}`);
        break;
      case 'get_dm_events':
        result = await client.get(`/api/dm/events?xAccountId=${a.xAccountId}${a.conversationId ? `&conversationId=${a.conversationId}` : ''}`);
        break;
      case 'create_engagement_gate':
        result = await client.post('/api/engagement-gates', a);
        break;
      case 'update_engagement_gate':
        result = await client.put(`/api/engagement-gates/${a.gateId}`, {
          ...(a.isActive !== undefined ? { isActive: a.isActive } : {}),
          ...(a.pollingStrategy ? { pollingStrategy: a.pollingStrategy } : {}),
          ...(a.expiresAfterHours !== undefined ? { expiresAfterHours: a.expiresAfterHours } : {}),
        });
        break;
      case 'list_engagement_gates':
        result = await client.get('/api/engagement-gates');
        break;
      case 'get_gate_deliveries':
        result = await client.get(`/api/engagement-gates/${a.gateId}/deliveries`);
        break;
      case 'process_gates':
        result = await client.post('/api/engagement-gates/process', {});
        break;
      case 'verify_gate':
        result = await client.get(`/api/engagement-gates/${a.gateId}/verify?username=${encodeURIComponent(a.username)}`);
        break;
      case 'create_step_sequence':
        result = await client.post('/api/step-sequences', a);
        break;
      case 'add_step_message':
        result = await client.post(`/api/step-sequences/${a.sequenceId}/messages`, a);
        break;
      case 'enroll_user':
        result = await client.post(`/api/step-sequences/${a.sequenceId}/enroll`, a);
        break;
      case 'list_step_sequences':
        result = await client.get(`/api/step-sequences${a.xAccountId ? `?xAccountId=${a.xAccountId}` : ''}`);
        break;
      case 'get_post_metrics':
        result = await client.get(`/api/posts/${a.tweetId}/metrics`);
        break;
      case 'get_gate_analytics':
        result = await client.get(`/api/engagement-gates/${a.gateId}/analytics`);
        break;
      case 'account_summary':
        result = await client.get('/api/x-accounts');
        break;
      case 'get_account_subscription':
        result = await client.get(`/api/x-accounts/${encodeURIComponent(a.xAccountId)}/subscription`);
        break;
      case 'list_staff':
        result = await client.get('/api/staff');
        break;
      case 'create_staff':
        result = await client.post('/api/staff', { name: a.name, role: a.role });
        break;
      case 'update_staff':
        result = await client.put(`/api/staff/${encodeURIComponent(a.id)}`, {
          ...(a.name !== undefined ? { name: a.name } : {}),
          ...(a.role !== undefined ? { role: a.role } : {}),
          ...(a.isActive !== undefined ? { isActive: a.isActive } : {}),
        });
        break;
      case 'delete_staff':
        result = await client.del(`/api/staff/${encodeURIComponent(a.id)}`);
        break;
      case 'create_campaign': {
        const conditions = a.conditions ?? {};
        const gatePayload: Record<string, any> = {
          xAccountId: a.xAccountId,
          postId: a.postId,
          triggerType: 'reply',
          actionType: 'verify_only',
          template: '',
          ...(conditions.requireLike !== undefined ? { requireLike: conditions.requireLike } : {}),
          ...(conditions.requireRepost !== undefined ? { requireRepost: conditions.requireRepost } : {}),
          ...(a.lineHarnessUrl ? { lineHarnessUrl: a.lineHarnessUrl } : {}),
          ...(a.lineHarnessApiKey ? { lineHarnessApiKey: a.lineHarnessApiKey } : {}),
          ...(a.formId ? { formId: a.formId } : {}),
          ...(a.ref ? { ref: a.ref } : {}),
        };
        const gate = await client.post<{ id: string }>('/api/engagement-gates', gatePayload);
        const lineBase = (a.lineHarnessUrl || process.env.LINE_HARNESS_URL || '').replace(/\/$/, '');
        const campaignLink = a.ref && lineBase
          ? `${lineBase}/r/${encodeURIComponent(a.ref)}${a.formId ? `?form=${encodeURIComponent(a.formId)}` : ''}`
          : null;
        result = { gate, campaignLink };
        break;
      }
      case 'get_usage_summary': {
        const qs = new URLSearchParams();
        if (a.xAccountId) qs.set('xAccountId', a.xAccountId);
        if (a.startDate) qs.set('startDate', a.startDate);
        if (a.endDate) qs.set('endDate', a.endDate);
        result = await client.get(`/api/usage${qs.toString() ? `?${qs}` : ''}`);
        break;
      }
      case 'get_usage_daily': {
        const qs = new URLSearchParams();
        if (a.xAccountId) qs.set('xAccountId', a.xAccountId);
        if (a.startDate) qs.set('startDate', a.startDate);
        if (a.endDate) qs.set('endDate', a.endDate);
        result = await client.get(`/api/usage/daily${qs.toString() ? `?${qs}` : ''}`);
        break;
      }
      case 'get_usage_by_gate': {
        const qs = new URLSearchParams();
        if (a.xAccountId) qs.set('xAccountId', a.xAccountId);
        if (a.startDate) qs.set('startDate', a.startDate);
        if (a.endDate) qs.set('endDate', a.endDate);
        result = await client.get(`/api/usage/by-gate${qs.toString() ? `?${qs}` : ''}`);
        break;
      }
      case 'scrape_user_posts':
        result = await scrapeUserPosts({ handle: a.handle, limit: a.limit });
        break;
      case 'scrape_search':
        result = await scrapeSearch({ query: a.query, type: a.type, lang: a.lang, minLikes: a.minLikes, limit: a.limit });
        break;
      case 'scrape_post':
        result = await scrapePost(a.urlOrId);
        break;
      case 'scrape_user':
        result = await scrapeUser({ handle: a.handle });
        break;
      case 'add_growth_source':
        result = await client.post('/api/growth/sources', {
          sourceTweetId: a.sourceTweetId,
          author: a.author,
          textEn: a.textEn,
          textJa: a.textJa,
          ...(a.summaryJa ? { summaryJa: a.summaryJa } : {}),
          ...(a.suggestedQuoteText ? { suggestedQuoteText: a.suggestedQuoteText } : {}),
          ...(a.videoUrl ? { videoUrl: a.videoUrl } : {}),
          ...(a.views != null ? { views: a.views } : {}),
          ...(a.likes != null ? { likes: a.likes } : {}),
          ...(a.theme ? { theme: a.theme } : {}),
          ...(a.transcript ? { transcript: a.transcript } : {}),
        });
        break;
      case 'list_growth_sources':
        result = await client.get(`/api/growth/sources${a.status ? `?status=${encodeURIComponent(a.status)}` : ''}`);
        break;
      case 'save_growth_article':
        result = await client.post('/api/growth/articles', {
          xAccountId: a.xAccountId,
          title: a.title,
          bodyMd: a.bodyMd,
          ...(a.imageUrl ? { imageUrl: a.imageUrl } : {}),
          ...(a.theme ? { theme: a.theme } : {}),
          ...(a.sourceTweetIds ? { sourceTweetIds: a.sourceTweetIds } : {}),
        });
        break;
      case 'list_growth_articles':
        result = await client.get(`/api/growth/articles${a.status ? `?status=${encodeURIComponent(a.status)}` : ''}`);
        break;
      case 'add_growth_draft':
        result = await client.post('/api/growth/drafts', {
          xAccountId: a.xAccountId,
          type: a.type,
          text: a.text,
          scheduledAt: a.scheduledAt,
          ...(a.quoteTweetId ? { quoteTweetId: a.quoteTweetId } : {}),
        });
        break;
      default:
        return { content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }], isError: true };
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  } catch (err: any) {
    return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
