export const cubelicToolDefs = [
  {
    name: 'cubelic_create_event',
    description: 'CUBΣLICのイベントを登録する。Xへの投稿は行わない。',
    inputSchema: { type: 'object' as const, additionalProperties: true },
  },
  {
    name: 'cubelic_create_content',
    description: '戦略設定の範囲内でCUBΣLICのContent Itemを登録する。',
    inputSchema: { type: 'object' as const, additionalProperties: true },
  },
  {
    name: 'cubelic_validate_media',
    description: 'Resolveメタデータを検証し、権利・映り込み・重複ゲートを評価する。権利を推測しない。',
    inputSchema: { type: 'object' as const, additionalProperties: true },
  },
  {
    name: 'cubelic_validate_rights',
    description: '保存済みイベントとメディアの権利ゲートを再評価する。',
    inputSchema: {
      type: 'object' as const,
      properties: { eventId: { type: 'string' }, assetId: { type: 'string' } },
      required: ['eventId', 'assetId'],
      additionalProperties: false,
    },
  },
  {
    name: 'cubelic_ingest_setlist',
    description: 'cubelic.gas-setlist.v1を取り込み、最大3件の人間確認用下書きを生成する。',
    inputSchema: { type: 'object' as const, additionalProperties: true },
  },
  {
    name: 'cubelic_generate_drafts',
    description: '保存済みContent Itemから最大3件の投稿候補を生成する。投稿・予約は行わない。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        contentId: { type: 'string' },
        mediaAssetId: { type: 'string' },
      },
      required: ['contentId'],
      additionalProperties: false,
    },
  },
  {
    name: 'cubelic_list_drafts',
    description: '人間確認キューの下書きを一覧する。',
    inputSchema: { type: 'object' as const, properties: { status: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'cubelic_get_draft',
    description: 'CUBΣLIC下書きの権利・品質・確認項目を取得する。',
    inputSchema: { type: 'object' as const, properties: { draftId: { type: 'string' } }, required: ['draftId'], additionalProperties: false },
  },
  {
    name: 'cubelic_collect_metrics',
    description: '公開済み投稿の指定時点メトリクスを取得する。取得不能値はnullのまま保存する。',
    inputSchema: {
      type: 'object' as const,
      properties: { postId: { type: 'string' }, window: { enum: ['2h', '24h', '72h', '7d'] } },
      required: ['postId', 'window'],
      additionalProperties: false,
    },
  },
  {
    name: 'cubelic_system_status',
    description: 'セーフモードと緊急停止の状態を取得する。',
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
  },
] as const;
