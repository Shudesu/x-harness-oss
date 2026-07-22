export const articleToolDefs = [
  {
    name: 'create_article',
    description:
      'X Article（長文記事）の下書きを作成する。bodyはMarkdown風テキスト（# 見出し / ## 小見出し / - リスト / > 引用 / **太字** / 空行で段落分け）。本文中に段落として単独で書いた ![キャプション](https://...) は実際にメディアをfetch→Xへアップロードしてインライン埋め込みになる（画像のほか動画URLならamplify_videoとしてチャンクアップロード+処理待ちまで自動。URLはhttps必須・到達不能なら下書き作成ごと400で失敗する。装飾でないMarkdown画像記法を不用意に含めないこと）。段落として単独で書いた https://x.com/…/status/… はポスト埋め込みentityになる。下書き作成は10件/24hの上限があり、バリデーションエラーでも1消費する。タイトルには文字数上限があり、超過するとdraft作成は201で通るのに公開APIが「article not found」を返す罠がある（44字は実測OK・60字超は不可、UIの下書き画面にだけ本当のエラーが出る）。公開にはアカウントのX Premium(いずれかのプラン)が必要 — 2026年1月に全Premiumへ開放済み',
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
