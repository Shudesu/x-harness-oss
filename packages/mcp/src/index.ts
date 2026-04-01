#!/usr/bin/env node
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
];

const server = new Server({ name: 'x-harness', version: '0.1.0' }, { capabilities: { tools: {} } });

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
        });
        break;
      case 'delete_post':
        result = await client.del(`/api/posts/${a.tweetId}`);
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
        result = await client.post('/api/dm/send', a);
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
