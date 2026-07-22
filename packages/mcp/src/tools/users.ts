export const userToolDefs = [
  { name: 'get_user', description: '【X API 課金あり】無料の scrape_user で代替できないか先に検討すること。Get X user info', inputSchema: { type: 'object' as const, properties: { username: { type: 'string' }, userId: { type: 'string' } } } },
  { name: 'search_users', description: '【X API 課金あり】無料の scrape_search で代替できないか先に検討すること。Search for X users', inputSchema: { type: 'object' as const, properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'follow', description: 'Follow a user', inputSchema: { type: 'object' as const, properties: { xAccountId: { type: 'string' }, targetUserId: { type: 'string' } }, required: ['xAccountId', 'targetUserId'] } },
  { name: 'unfollow', description: 'Unfollow a user', inputSchema: { type: 'object' as const, properties: { xAccountId: { type: 'string' }, targetUserId: { type: 'string' } }, required: ['xAccountId', 'targetUserId'] } },
  { name: 'get_followers', description: '【X API 課金あり・大量課金事故の前例あり】Get followers', inputSchema: { type: 'object' as const, properties: { xAccountId: { type: 'string' } }, required: ['xAccountId'] } },
  { name: 'get_following', description: '【X API 課金あり】Get following', inputSchema: { type: 'object' as const, properties: { xAccountId: { type: 'string' } }, required: ['xAccountId'] } },
];
