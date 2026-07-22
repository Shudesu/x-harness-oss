export const analyticsToolDefs = [
  { name: 'get_post_metrics', description: '【X API 課金あり】無料の scrape_post で代替できないか先に検討すること。Get tweet metrics', inputSchema: { type: 'object' as const, properties: { tweetId: { type: 'string' } }, required: ['tweetId'] } },
  { name: 'get_gate_analytics', description: 'Get gate delivery stats', inputSchema: { type: 'object' as const, properties: { gateId: { type: 'string' } }, required: ['gateId'] } },
  { name: 'account_summary', description: 'Get account summary', inputSchema: { type: 'object' as const, properties: {} } },
  { name: 'get_account_subscription', description: 'アカウントのPremium/サブスクリプション状態を取得する', inputSchema: { type: 'object' as const, properties: { xAccountId: { type: 'string' } }, required: ['xAccountId'] } },
];
