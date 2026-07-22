# X Articles API 実測ガイド — 画像込み長文記事の全自動投稿

X の Articles API(長文記事)は公式ドキュメントが薄く、`content_state` の中身はほぼ undocumented です。X Harness はバリデータのエラーメッセージ解読と公開記事の読み戻し(fxtwitter)でスキーマを実測し、**markdown を渡すだけで本文中の画像込みの記事を draft 作成→公開まで全自動**にしています。このページはその実測結果のフィールドノートです(2026-07-18 時点、実記事の公開まで検証済み)。

## 使い方(X Harness 経由)

MCP ツール `create_article` に markdown の body を渡すだけです。

```
create_article:
  title: 記事タイトル
  body: |
    ## 見出し
    本文。**太字**も使えます。

    ![図解のキャプション](https://example.com/figure1.png)

    - リスト
    > 引用
  coverMediaId: <upload_image で取得したメディアID>   # カバー画像(任意)
```

- 段落として単独で書いた `![キャプション](https://...)` は、Worker が**実際に画像を fetch → X にアップロード → インライン画像 entity に変換**します(URL は https 必須)
- 到達不能な画像 URL が 1 つでもあると、**draft 作成前に 400 で fail-fast** します(後述のレート制限を守るための設計)
- 冒頭の `# タイトル` が記事タイトルと同一なら自動で除去されます(Articles はタイトルを別枠表示するため二重になる)
- 公開は `publish_article`(**X Premium が必要** — 2024年の登場時は Premium+ 限定だったが、2026-01-07 に全 Premium プランへ開放された。実測: Premium(月額プラン)アカウントで publish 成功)

## レート制限(実測値)

| 操作 | 制限 | 注意 |
|---|---|---|
| draft 作成 `POST /2/articles/draft` | **10 件 / 24h** | **400 バリデーションエラーでも 1 消費する** |
| 公開 `POST /2/articles/:id/publish` | **5 件 / 24h** | draft とは別枠 |
| メディアアップロード | 500 / 15 分 | media_id は **24h で失効**(expires_after_secs) |

- 24h 窓のリセット時刻は `x-user-limit-24hour-reset` ヘッダで確認する(15 分窓の reset と混同しやすい)
- draft の取得・更新・削除系エンドポイントは**存在しない**(GET /2/articles 系は全部 404)。作った draft の削除は X の記事エディタ UI からのみ
- コスト実測: 下書き $0.01 + カバー $0.005 + 公開 $0.01 ≒ 記事 1 本 4 円

## content_state 書き側スキーマ(実測)

```json
{
  "blocks": [
    {"text": "本文の段落。", "type": "unstyled",
     "inline_style_ranges": [{"offset": 0, "length": 2, "style": "bold"}]},
    {"text": " ", "type": "atomic",
     "entity_ranges": [{"offset": 0, "length": 1, "key": 0}]}
  ],
  "entities": [
    {"key": "0", "value": {"type": "image", "mutability": "immutable",
      "data": {"caption": "任意のキャプション",
               "media_items": [{"media_id": "<アップロード済みID>", "media_category": "tweet_image"}]}}}
  ]
}
```

ハマりどころ(全部バリデータに拒否されて判明):

- **フィールド名は全部 snake_case**: `entity_ranges` / `inline_style_ranges` / `media_items`。DraftJS 標準の camelCase(`entityRanges` 等)や、読み側 API が返す camelCase(`mediaItems` / `mediaId`)を送ると `additionalProperties` エラーで拒否される — **読み側と書き側でスキーマが非対称**
- **inline style の enum は小文字** `[bold, italic, strikethrough]`。読み側は `"Bold"` と返してくるが、書き側に `"Bold"` を送ると enum エラー
- block type: `unstyled` / `header-one` / `header-two` / `blockquote` / `ordered-list-item` / `unordered-list-item` / `atomic`
- entity の `value.type` enum(小文字): `[post, link, image, emoji, markdown, divider, latex]`、`mutability` も小文字(`immutable`)
- 画像は `atomic` block(text は半角スペース 1 文字)+ `entity_ranges` で entity を参照する
- `media_category` は**アップロード時のカテゴリと一致必須**(X Harness は `tweet_image` で統一)
- カバー画像は `cover_media: {media_id, media_category}` — `media_category` 必須

## entity data スキーマ一覧(type 別)

バリデータは data 内の未知キーを拒否するが、**必須キーは無い**(空 `{}` でも通る — 通っても描画されないだけ)。

| type | data スキーマ | 備考 |
|---|---|---|
| `image` | `{caption?, url?, media_items: [{media_id, media_category}]}` | 公開までレンダリング検証済み |
| `post` | `{post_id?, url?, entity_key?}` | ツイート埋め込み。キー名は確定、レンダリング未検証 |
| `link` | `{url}` | |
| `markdown` | `{markdown}` | |
| `emoji` | `{url}` | 読み側は twemoji SVG の URL |
| `divider` | `{}` | |
| `latex` | 不明 | latex / formula / text いずれも拒否 |

動画は専用の entity type が無く、`media_items` の `media_category` を `tweet_video` にする想定(未検証)。

## 解読テクニック(再現手順)

1. **書き側**: 1 リクエストの data に候補キーを全部載せて POST すると、バリデータが未知キーを全列挙してくれる。**エラーに出なかったキーが正解**(1 回で全マップが取れる。ただし draft 枠を 1 消費)
2. **読み側**: 公開記事なら `https://api.fxtwitter.com/i/status/<post_id>` の `tweet.article.content.entityMap` と `media_entities` で実構造が読める(無認証・無料)。公開後の検証もこれで自動化できる
3. 読み側の構造をそのまま書き側に送っても通らない(camelCase / enum 大文字問題)。**書き側は必ずバリデータで答え合わせ**する
