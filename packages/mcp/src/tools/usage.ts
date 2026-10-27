export const usageToolDefs = [
  {
    name: 'get_cost_forecast',
    description:
      '月末のX API費用見込み、予算による減速、企画別費用を取得。任意で新規企画も見積もる。単価は要確認。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tier: { type: 'string', enum: ['simple', 'standard', 'strict'] },
        expectedReplies: { type: 'integer', minimum: 0 },
        quota: { type: 'integer', minimum: 0 },
        verifyFollow: { type: 'boolean' },
        days: { type: 'integer', minimum: 1, maximum: 60 },
      },
    },
  },
  {
    name: 'get_usage_summary',
    description: 'API使用量サマリーを取得する',
    inputSchema: {
      type: 'object' as const,
      properties: {
        xAccountId: { type: 'string' },
        startDate: { type: 'string', description: '集計開始日（YYYY-MM-DD）' },
        endDate: { type: 'string', description: '集計終了日（YYYY-MM-DD）' },
      },
    },
  },
  {
    name: 'get_usage_daily',
    description: 'API使用量の日別内訳を取得する',
    inputSchema: {
      type: 'object' as const,
      properties: {
        xAccountId: { type: 'string' },
        startDate: { type: 'string', description: '集計開始日（YYYY-MM-DD）' },
        endDate: { type: 'string', description: '集計終了日（YYYY-MM-DD）' },
      },
    },
  },
  {
    name: 'get_usage_by_gate',
    description: 'ゲートごとのAPI使用量内訳を取得する',
    inputSchema: {
      type: 'object' as const,
      properties: {
        xAccountId: { type: 'string' },
        startDate: { type: 'string', description: '集計開始日（YYYY-MM-DD）' },
        endDate: { type: 'string', description: '集計終了日（YYYY-MM-DD）' },
      },
    },
  },
];
