---
name: x-growth-discover
description: X の海外バズ投稿(特に動画)を無料で発見し、翻訳+引用RT文面案つきでソース候補に登録する。トリガー: ネタ探し, ネタ発見, 海外バズ, discover, ソース収集, バズ収集
---

# X Growth: ネタ発見(海外バズ → ソース候補)

X Harness MCP の無料 scrape ツールで海外のバズ投稿を発見し、ダッシュボードでレビューできる形で D1 に登録する。X API 読み取り課金ゼロ。

## 前提

- X Harness MCP がセットアップ済み(X_HARNESS_API_URL / X_HARNESS_API_KEY)
- twitter-cli + TWITTER_AUTH_TOKEN / TWITTER_CT0(収集専用サブアカウント推奨)

## 手順

1. **検索クエリを決める** — ユーザーの発信ジャンルに合わせる。指定がなければ聞く。例:
   - `claude code` / `AI agent` / `openai` (AI系)
   - 複数クエリを回すと発見率が上がる(3〜10個)
2. **`scrape_search` で発見** — `type: "videos"`(動画優先)または `"top"`、`lang: "en"`、`minLikes: 1000` 以上を目安。
   - 注意: `from:` 演算子は 0 件になる。特定ユーザーは `scrape_user_posts` を使う。
3. **候補を絞る** — いいね数・views・自分のジャンルとの一致で上位を選ぶ。すでに登録済みか `list_growth_sources` で確認し重複登録しない。
4. **`scrape_post` で全文+動画情報を取得** — 返却の `embedUrl` は動画引用投稿に使える(x-growth-video スキル参照)。
5. **翻訳+文面案を作る** — textJa(自然な日本語訳)、summaryJa(1〜2文要約)、suggestedQuoteText(引用RT文面案 150〜400字: フック1行→空行→内容の分解→ひとこと感想)。
6. **`add_growth_source` で登録** — sourceTweetId / author / textEn / textJa / summaryJa / suggestedQuoteText / videoUrl / views / likes / theme を渡す。
7. **報告** — 登録した件数とダッシュボード(管理画面の Growth → 海外ネタタブ)でレビューできることを伝える。

## 品質基準

- 訳は直訳でなく「日本の読者が読んで意味がわかる」自然さ
- theme は後でピラー記事と紐付けるためのタグ(例: ai-tools, automation, marketing)を一貫して付ける
