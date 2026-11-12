export const articleToolDefs = [
  {
    name: 'create_article',
    description:
      'X Article（長文記事）の下書きを作成する。bodyはMarkdownで書けばX Articles公式のcontent_state(DraftJS)に変換される: # 見出し→大見出し / ## と ### →小見出し（Articlesは2階層のみ） / - ・1. リスト / > 引用 / **太字** *斜体* ~~取消線~~ / [テキスト](https://...) と裸URL→リンク / GFM表と```コード```→markdownブロック / --- →区切り線 / 単独行の https://x.com/…/status/… →ポスト埋め込み。単独行の ![キャプション](https://...) は画像をfetch→Xへアップロードしてインライン埋め込み（動画URLならamplify_video）。![キャプション](media:<mediaId>) と書けば upload_image 済みのメディアIDを直接使う（GIFは media:<id>#tweet_gif）。取得・アップロードに失敗した画像は記事全体を失敗させずスキップし、レスポンスの warnings に理由を返す。下書き作成は10件/24hの上限があり、バリデーションエラーでも1消費する（表・コードの加重文字数合計が1万超なら送信前に400で止める）。タイトルが60字を超えると warnings で警告する — draft作成は201で通るのに公開APIが「article not found」を返す罠がある（44字は実測OK）。公開にはアカウントのX Premium(いずれかのプラン)が必要 — 2026年1月に全Premiumへ開放済み',
    inputSchema: {
      type: 'object' as const,
      properties: {
        xAccountId: { type: 'string' },
        title: { type: 'string', description: '記事タイトル' },
        body: { type: 'string', description: '記事本文（Markdown。空行区切りで段落）' },
        coverMediaId: { type: 'string', description: 'カバー画像のメディアID（upload_image ツールで取得。省略するとカバー無しで作成される — 記事のサムネイルが必要なら必ず指定すること。推奨サイズ 1500×600 の 5:2）' },
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
