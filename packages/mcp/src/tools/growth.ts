export const growthToolDefs = [
  {
    name: 'add_growth_source',
    description:
      '海外バズ投稿などのネタをソース候補として保存する(ダッシュボードの「海外ネタ」タブでレビューできる)。scrape_search / scrape_post で見つけた投稿を、原文+日本語訳+引用RT文面案つきで登録する。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sourceTweetId: { type: 'string', description: '元ポストのツイートID' },
        author: { type: 'string', description: '元ポストの投稿者ハンドル' },
        textEn: { type: 'string', description: '原文' },
        textJa: { type: 'string', description: '日本語訳' },
        summaryJa: { type: 'string', description: '日本語要約' },
        suggestedQuoteText: { type: 'string', description: '引用RT文面案' },
        videoUrl: { type: 'string', description: '動画URL(あれば)' },
        views: { type: 'number' },
        likes: { type: 'number' },
        theme: { type: 'string', description: 'テーマタグ(ピラー紐付け用)' },
        transcript: { type: 'string', description: '動画の文字起こし(あれば)' },
      },
      required: ['sourceTweetId', 'author', 'textEn', 'textJa'],
    },
  },
  {
    name: 'list_growth_sources',
    description: 'ソース候補の一覧を取得する(status: new / drafted / dismissed でフィルタ可)。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'new / drafted / dismissed' },
      },
    },
  },
  {
    name: 'save_growth_article',
    description:
      '長文記事の下書きを保存する(ダッシュボードの「記事」タブでレビューできる)。自動公開はされない — レビュー後に create_article / publish_article(Premium+ 必要)で公開する。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        xAccountId: { type: 'string' },
        title: { type: 'string' },
        bodyMd: { type: 'string', description: 'Markdown 本文' },
        imageUrl: { type: 'string', description: 'ヘッダー画像URL(任意)' },
        theme: { type: 'string' },
        sourceTweetIds: { type: 'array', items: { type: 'string' }, description: '元ネタのツイートID群' },
      },
      required: ['xAccountId', 'title', 'bodyMd'],
    },
  },
  {
    name: 'list_growth_articles',
    description: '記事下書きの一覧を取得する(status フィルタ可)。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string' },
      },
    },
  },
  {
    name: 'add_growth_draft',
    description:
      '投稿ドラフトを承認キューに入れる(ダッシュボードの承認画面で ok/編集/却下 → 予約投稿)。scheduledAt は必ず YYYY-MM-DDTHH:MM:SS+09:00 形式(それ以外だと予約発火時刻がずれる)。動画引用投稿は text 末尾に scrape_post の embedUrl を含め、quoteTweetId にピラー投稿IDを指定できる。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        xAccountId: { type: 'string' },
        type: { type: 'string', description: '投稿タイプ(例: quote_rt / video / opinion / progress)' },
        text: { type: 'string', description: '投稿本文' },
        scheduledAt: { type: 'string', description: 'YYYY-MM-DDTHH:MM:SS+09:00 形式必須' },
        quoteTweetId: { type: 'string', description: '引用するツイートID(ピラー紐付け用、任意)' },
      },
      required: ['xAccountId', 'type', 'text', 'scheduledAt'],
    },
  },
];
