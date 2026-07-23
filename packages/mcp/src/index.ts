#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { XHarnessClient } from './client.js';
import { cubelicToolDefs } from './tools/cubelic.js';

const API_URL = process.env.X_HARNESS_API_URL ?? 'http://localhost:8787';
const API_KEY = process.env.HERMES_ACCESS_TOKEN ?? '';
const client = new XHarnessClient(API_URL, API_KEY);
const toolNames = new Set<string>(cubelicToolDefs.map((tool) => tool.name));
const pkgVersion: string = createRequire(import.meta.url)('../package.json').version;
const server = new Server({ name: 'x-harness-cubelic', version: pkgVersion }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: cubelicToolDefs }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const input = (args ?? {}) as Record<string, unknown>;
  try {
    if (!toolNames.has(name)) throw new Error(`Tool ${name} is not available in CUBΣLIC Phase 1`);

    let result: unknown;
    switch (name) {
      case 'cubelic_create_event': result = await client.post('/api/cubelic/events', input); break;
      case 'cubelic_create_content': result = await client.post('/api/cubelic/content', input); break;
      case 'cubelic_validate_media': result = await client.post('/api/cubelic/media/validate', input); break;
      case 'cubelic_validate_rights': result = await client.post('/api/cubelic/rights/validate', input); break;
      case 'cubelic_ingest_setlist': result = await client.post('/api/cubelic/setlists/ingest', input); break;
      case 'cubelic_generate_drafts': result = await client.post('/api/cubelic/drafts/generate', input); break;
      case 'cubelic_list_drafts': {
        const status = typeof input.status === 'string' ? `?status=${encodeURIComponent(input.status)}` : '';
        result = await client.get(`/api/cubelic/drafts${status}`);
        break;
      }
      case 'cubelic_get_draft': {
        if (typeof input.draftId !== 'string') throw new Error('draftId is required');
        result = await client.get(`/api/cubelic/drafts/${encodeURIComponent(input.draftId)}`);
        break;
      }
      case 'cubelic_collect_metrics': result = await client.post('/api/cubelic/metrics/collect', input); break;
      case 'cubelic_system_status': result = await client.get('/api/cubelic/admin/status'); break;
      default: throw new Error(`Tool ${name} is not implemented`);
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown MCP error';
    return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'MCP startup failed');
  process.exitCode = 1;
});
