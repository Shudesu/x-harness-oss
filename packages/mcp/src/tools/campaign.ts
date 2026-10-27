export const campaignToolDefs = [
  {
    name: 'draft_campaign',
    description:
      'キャンペーン案と検証結果を返す。保存しない。create_campaignの前に必ず利用者に内容を確認する。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        xAccountId: { type: 'string' },
        brief: { type: 'string', minLength: 1, maxLength: 500 },
        tier: { type: 'string', enum: ['simple', 'standard', 'strict'] },
        awardMode: { type: 'string', enum: ['first_come', 'lottery'] },
        quota: { type: 'integer', minimum: 0 },
        rewardHint: { type: 'string', maxLength: 200 },
      },
      required: ['xAccountId', 'brief'],
    },
  },
  {
    name: 'get_campaign_digest',
    description: 'キャンペーンの結果通知と配信状態を取得する。送信しない。',
    inputSchema: {
      type: 'object' as const,
      properties: { gateId: { type: 'string' } },
      required: ['gateId'],
    },
  },
  {
    name: 'get_campaign_status',
    description: 'キャンペーンの公開残数・参加人数を取得する。',
    inputSchema: {
      type: 'object' as const,
      properties: { gateId: { type: 'string' } },
      required: ['gateId'],
    },
  },
  {
    name: 'create_campaign',
    description:
      'draft_campaignの結果をそのまま保存せず利用者確認後に呼ぶ。LINE先行キャンペーンの参加リンクを作成する。既存X告知投稿と署名連携済みLINE接続を指定。Xへの投稿・DMは行わない。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        xAccountId: { type: 'string' },
        postId: { type: 'string' },
        lineConnectionId: { type: 'string' },
        title: { type: 'string', maxLength: 100 },
        slug: { type: 'string', pattern: '^[a-z0-9-]{2,64}$' },
        claimPhrase: { type: 'string', minLength: 2, maxLength: 8 },
        endsAt: { type: 'string', description: 'Timezone-qualified ISO date' },
        tier: { type: 'string', enum: ['simple', 'standard', 'strict'] },
        awardMode: { type: 'string', enum: ['first_come', 'lottery'] },
        followPolicy: { type: 'string', enum: ['none', 'ask', 'verify_winners'] },
        likePolicy: {
          type: 'string',
          enum: ['none', 'ask', 'verify_winners'],
          description: 'いいね確認は最大100人。確認不能は失格にしない。',
        },
        verifyConditionsOptIn: { type: 'boolean' },
        requireFollow: {
          type: 'boolean',
          description: '非推奨。trueはverify_winners。標準は明示オプトイン必須。',
        },
        minAccountAgeDays: { type: 'integer', minimum: 0 },
        minFollowers: { type: 'integer', minimum: 0 },
        settleSec: { type: 'integer', minimum: 0, maximum: 300 },
        budgetUsd: { type: 'number', minimum: 0 },
        postCostUsd: { type: 'number', minimum: 0 },
        externalCostUsd: { type: 'number', minimum: 0 },
        rewards: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              type: { type: 'string', enum: ['coupon_code', 'url', 'line_message', 'file'] },
              value: { type: 'string' },
              quota: { type: ['integer', 'null'], minimum: 0 },
              weight: { type: 'number', minimum: 0 },
              consolation: { type: 'boolean' },
              codes: { type: 'array', items: { type: 'string' }, maxItems: 1000 },
              unitCost: { type: 'number', minimum: 0 },
            },
            required: ['label', 'type', 'value', 'quota'],
          },
        },
        entryPage: { type: 'string', enum: ['redirect', 'status'] },
        messageTemplates: {
          type: 'object',
          properties: {
            won: { type: 'string', maxLength: 500 },
            lost: { type: 'string', maxLength: 500 },
          },
        },
        loserFollowup: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            offer: { type: 'string', enum: ['coupon', 'early_notice', 'both'] },
            couponRewardIndex: { type: 'integer', minimum: 0, maximum: 9 },
            label: { type: 'string', maxLength: 40 },
          },
          required: ['enabled', 'offer'],
        },
        earlyNoticeFromGateIds: { type: 'array', maxItems: 5, items: { type: 'string' } },
        confirmEarlyNotice: {
          type: 'boolean',
          description:
            '先行案内の対象見込みを利用者が確認した場合のみtrue。LINE側には送信せず下書きを作る。',
        },
        scenarios: {
          type: 'object',
          properties: {
            claimed: { type: 'string' },
            won: { type: 'string' },
            lost: { type: 'string' },
          },
        },
      },
      required: [
        'xAccountId',
        'postId',
        'lineConnectionId',
        'title',
        'slug',
        'claimPhrase',
        'endsAt',
        'rewards',
      ],
    },
  },
  {
    name: 'get_gate_funnel',
    description: 'キャンペーンの参加・判定・配布・LINE反応、計上済み費用と通知失敗を取得する。',
    inputSchema: {
      type: 'object' as const,
      properties: { gateId: { type: 'string' } },
      required: ['gateId'],
    },
  },
];
