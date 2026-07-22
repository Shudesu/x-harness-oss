export const scrapeToolDefs = [
  {
    name: 'scrape_user_posts',
    description:
      '【無料・X API 課金なし】twitter-cli(Cookie 認証)で指定ユーザーの最近の投稿+メトリクス(いいね/RT/views)を取得する。自分やベンチマークアカウントの分析はこれを使う。注意: 特定ユーザーの投稿を search の from: クエリで探すと 0 件になるため必ずこのツールを使うこと。要セットアップ: twitter-cli + TWITTER_AUTH_TOKEN / TWITTER_CT0(収集専用サブアカウント推奨)。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        handle: { type: 'string', description: 'ユーザー名(@ なし可)' },
        limit: { type: 'number', description: '最大取得件数(省略時は CLI デフォルト)' },
      },
      required: ['handle'],
    },
  },
  {
    name: 'scrape_search',
    description:
      '【無料・X API 課金なし】twitter-cli(Cookie 認証)で X を検索する。バズ・ニュース・ネタ発見用。type=videos で動画付き投稿のみ。注意: from: 演算子は 0 件になるので特定ユーザーは scrape_user_posts を使う。有料の search_posts / search_news より先にこちらを検討すること。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: '検索クエリ' },
        type: { type: 'string', enum: ['top', 'latest', 'videos'], description: 'デフォルト top' },
        lang: { type: 'string', description: '言語コード(例: en, ja)' },
        minLikes: { type: 'number', description: '最小いいね数フィルタ' },
        limit: { type: 'number', description: '最大取得件数' },
      },
      required: ['query'],
    },
  },
  {
    name: 'scrape_post',
    description:
      '【無料・認証不要】fxtwitter API で単一ポストの全文・メトリクス・動画情報を取得する。動画がある場合は embedUrl(https://x.com/<author>/status/<id>/video/1)を返す — この URL を自分の投稿本文に貼ると X が元動画をツイート内に展開する(再アップ不要)。動画引用投稿はこの embedUrl を使うこと。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        urlOrId: { type: 'string', description: 'ツイート URL または ID' },
      },
      required: ['urlOrId'],
    },
  },
  {
    name: 'scrape_user',
    description:
      '【無料・X API 課金なし】twitter-cli(Cookie 認証)でユーザーのプロフィール・フォロワー数を取得する。有料の get_user より先にこちらを検討すること。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        handle: { type: 'string', description: 'ユーザー名(@ なし可)' },
      },
      required: ['handle'],
    },
  },
];
