export const articleToolDefs = [
  {
    name: 'create_article',
    description: 'X Article（長文記事）の下書きを作成する。bodyはMarkdown風テキスト（# 見出し / ## 小見出し / - リスト / > 引用 / 空行で段落分け）。公開にはアカウントのPremium+が必要',
    inputSchema: {
      type: 'object' as const,
      properties: {
        xAccountId: { type: 'string' },
        title: { type: 'string', description: '記事タイトル' },
        body: { type: 'string', description: '記事本文（Markdown風。空行区切りで段落）' },
        coverMediaId: { type: 'string', description: 'カバー画像のメディアID（upload_image等で取得）' },
      },
      required: ['xAccountId', 'title', 'body'],
    },
  },
  {
    name: 'publish_article',
    description: '下書きArticleを公開する。公開されたポストIDが返る',
    inputSchema: {
      type: 'object' as const,
      properties: {
        xAccountId: { type: 'string' },
        articleId: { type: 'string', description: 'create_articleで返された記事ID' },
      },
      required: ['xAccountId', 'articleId'],
    },
  },
  {
    name: 'search_news',
    description: '【X API 課金あり】無料の scrape_search で代替できないか先に検討すること。X上のブレイキングニュースを検索する（要約・関連ポストクラスタ付き）。記事ネタ収集に使える',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: '検索トピック（例: AI, 生成AI）' },
        maxResults: { type: 'number', description: '取得件数（デフォルト10、最大50）' },
        xAccountId: { type: 'string', description: '使用するXアカウント（省略時は先頭アカウント）' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_news',
    description: '【X API 課金あり】ニュースストーリーの詳細（要約・コンテキスト・関連ポストID一覧）を取得する',
    inputSchema: {
      type: 'object' as const,
      properties: {
        newsId: { type: 'string' },
        xAccountId: { type: 'string', description: '使用するXアカウント（省略時は先頭アカウント）' },
      },
      required: ['newsId'],
    },
  },
  {
    name: 'get_activity_events',
    description: 'X Activity API (XAA) webhookで受信したイベント（post.create / post.delete / dm等）を新しい順に取得する',
    inputSchema: {
      type: 'object' as const,
      properties: {
        eventType: { type: 'string', description: 'フィルタ（例: post.create, post.delete）' },
        limit: { type: 'number', description: '取得件数（デフォルト50、最大200）' },
      },
      required: [],
    },
  },
];
