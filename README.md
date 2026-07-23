# X Harness

<p align="center">
  <a href="https://x.com/ai_shunoda/status/2042184859003818077">
    <img src="https://img.shields.io/badge/%F0%9D%95%8F_X_Harness_%E3%82%92%E7%84%A1%E6%96%99%E3%81%A7%E4%BD%93%E9%A8%93%E3%81%99%E3%82%8B-black?style=for-the-badge&logo=x&logoColor=white&labelColor=000000" alt="X Harness を無料で体験する" height="50">
  </a>
</p>

X（旧Twitter）向けオープンソースマーケティングオートメーション。
Xステップ・SocialDog の代替として、無料（または低コスト）で運用できます。

## 機能

- **エンゲージメントゲート** — リプライ + いいね/リポスト/フォロー条件でLINE連携・verify API
- **キャンペーンウィザード** — 投稿→条件→LINE連携→プレビューの4ステップで一括設定
- **投稿管理** — テキスト・画像・動画投稿、スレッド作成、スケジュール投稿
- **リプライ管理** — 受信リプライの確認、ワンクリックいいね/リポスト、返信、自分のリプライ表示
- **引用ツイート** — 引用RT自動検出、DB永続化、引用RTで返しアクション
- **DM管理** — 会話一覧（プロフィール表示）、メッセージ履歴、送受信
- **フォロワー管理** — ゲート通過者の管理、タグ付け、セグメント分け
- **フォロワー数トラッキング** — 日次スナップショット、推移グラフ、7日/30日増減表示
- **API使用量** — エンドポイント別、ゲート別のコスト可視化
- **スタッフ管理** — owner / admin / editor / viewer の4ロール、APIキーごとの権限制御
- **無料スクレイピング収集** — twitter-cli(Cookie 認証)で検索・投稿収集・メトリクス取得が X API 課金ゼロ(`scrape_*` MCP ツール)
- **動画コンテンツ自動化** — 海外動画バズ発見 → `/video/1` URL 引用投稿の生成・予約(x-growth-video スキル)
- **記事自動生成** — ネタ収集 → 長文記事下書き → ダッシュボードレビュー(x-growth-discover / x-growth-article スキル)
- **画像込み記事の全自動投稿** — body の markdown に `![](url)` を書くだけでインライン画像を自動アップロードして X Article を draft 作成→公開(undocumented スキーマの実測ガイドは [docs/manual/07-articles-api.md](docs/manual/07-articles-api.md))
- **MCP Server** — Claude Code / AI エージェントから自然言語でX操作
- **Codex CLI 対応** — MCP・スキルとも Claude Code / Codex CLI の両方で動作
- **SDK** — TypeScript SDK でプログラマティックに全機能を操作
- **管理画面** — Next.js ダッシュボードで直感的に操作
- **マルチアカウント** — サイドバーでアカウント切替、全ページが選択アカウントに連動
- **LINE Harness連携** — クロスプラットフォームキャンペーン（X→LINE特典配布）
- **ステルス設計** — ジッター・レート制限・テンプレート変異でBAN対策

## 競合比較

| 機能 | X Harness | Xステ◯プ | S◯cialD◯g |
|------|-----------|-----------|-----------|
| 月額料金 | **$0** | ¥21,780〜 | ¥1,980〜 |
| エンゲージメントゲート | ✅ | ✅ | ❌ |
| キャンペーンウィザード | ✅ | ❌ | ❌ |
| LINE連携 | ✅ | ❌ | ❌ |
| 投稿管理 | ✅ | ✅ | ✅ |
| DM管理 | ✅ | ✅ | ❌ |
| リプライ一括操作 | ✅ | ❌ | ❌ |
| 引用RT管理 | ✅ | ❌ | ❌ |
| フォロワー分析 | ✅ | ✅ | ✅ |
| API使用量可視化 | ✅ | ❌ | ❌ |
| MCP (AI連携) | ✅ | ❌ | ❌ |
| SDK | ✅ | ❌ | ❌ |
| セルフホスト | ✅ | ❌ | ❌ |
| オープンソース | ✅ | ❌ | ❌ |

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| API / Webhook | Cloudflare Workers + Hono |
| データベース | Cloudflare D1 (SQLite) |
| 定期実行 | Workers Cron Triggers (5分毎) |
| 管理画面 | Next.js 15 (App Router) + Tailwind CSS |
| SDK | TypeScript, ESM + CJS, ゼロ依存 |
| MCP Server | Model Context Protocol, `@x-harness/sdk` ベース |
| X連携 | X API v2 + OAuth 1.0a |

## 本番運用前の安全確認

X Harness は投稿、DM、フォローなど、X アカウントに直接影響する操作を自動化できます。
インターネットへ公開する前に、管理 API キー、X アプリ権限、公開エンドポイント、
MCP / Cron の実行権限、バックアップと停止手順を確認してください。

本番向けのチェックリストは
[運用セキュリティガイド](docs/operational-security.md) を参照してください。

## アーキテクチャ

```
X Platform (API v2) ←→ CF Workers (Hono) → D1
                              |
                        Cron (*/5 * * * *)
                              |
                   リプライ検出 (since_id)
                   + フォロワー数スナップショット
                   + 引用RT DB保存

Next.js 15 (Dashboard) → Workers API → D1
TypeScript SDK → Workers API → D1
MCP Server → Workers API → D1
LINE Harness → Verify API → D1
```

## MCP Server (AI連携)

Claude Code や他のMCPクライアントから、自然言語でXアカウントを操作できます。

### セットアップ

```json
// .mcp.json
{
  "mcpServers": {
    "x-harness": {
      "command": "npx",
      "args": ["-y", "@x-harness/mcp@latest"],
      "env": {
        "X_HARNESS_API_URL": "https://your-worker.workers.dev",
        "X_HARNESS_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Codex CLI から使う

`~/.codex/config.toml` に追加すると Codex CLI からも同じツールが使えます:

```toml
[mcp_servers.x-harness]
command = "npx"
args = ["-y", "@x-harness/mcp@latest"]

[mcp_servers.x-harness.env]
X_HARNESS_API_URL = "https://your-worker.workers.dev"
X_HARNESS_API_KEY = "your-api-key"
# 無料収集を使う場合(下記セクション参照)
TWITTER_AUTH_TOKEN = "your-auth-token"
TWITTER_CT0 = "your-ct0"
```

## 無料収集セットアップ(twitter-cli)

X の読み取り(検索・投稿収集・メトリクス)を **X API 課金ゼロ**で行えます。[twitter-cli](https://github.com/public-clis/twitter-cli)(Cookie 認証)を MCP がラップし、`scrape_user_posts` / `scrape_search` / `scrape_post` / `scrape_user` ツールとして使えます。書き込み(投稿・予約)は従来通り X API 経由です。

### 1. twitter-cli をインストール

```bash
uv tool install twitter-cli   # または: pipx install twitter-cli
```

### 2. Cookie を取得

ブラウザで x.com にログイン → 開発者ツール → Application → Cookies → `x.com` から `auth_token` と `ct0` の値をコピー。

> ⚠ **凍結リスクの注意**: 収集専用の**サブアカウント**の Cookie を推奨します。投稿(write)は X API 経由なのでメインアカウントの Cookie は不要です。Cookie はローカルの設定ファイルにのみ保存され、サーバー(Worker/D1)には送信されません。

### 3. MCP の env に設定

`.mcp.json`(Claude Code)または `~/.codex/config.toml`(Codex)の x-harness サーバーの env に追加:

```json
"env": {
  "X_HARNESS_API_URL": "...",
  "X_HARNESS_API_KEY": "...",
  "TWITTER_AUTH_TOKEN": "your-auth-token",
  "TWITTER_CT0": "your-ct0"
}
```

twitter-cli が PATH 外にある場合は `TWITTER_BIN` でフルパスを指定できます。

### 4. 同梱スキル(記事・動画自動化)

`skills/` に SKILL.md 標準のスキルが3本入っています(Claude Code / Codex 両対応)。`.claude/skills/` と `.codex/skills/` にコピーして使います(`npx create-x-harness` は自動でコピーします):

| スキル | 内容 |
|--------|------|
| `x-growth-discover` | 海外バズ発見 → 翻訳+引用RT文面案 → ダッシュボード「海外ネタ」タブへ |
| `x-growth-article` | ソース候補 → 長文記事(4,000〜7,000字)下書き → 「記事」タブでレビュー |
| `x-growth-video` | 動画バズ発見 → `/video/1` URL 引用投稿を生成・予約(承認 or フルオート) |

### 5. 毎日自動で回す(cron)

```bash
# Claude Code
30 5 * * * cd /path/to/project && claude -p "/x-growth-video --auto" --dangerously-skip-permissions

# Codex CLI
30 5 * * * cd /path/to/project && codex exec "x-growth-video スキルを --auto で実行"
```

### 利用可能なツール (39個)

| カテゴリ | ツール | 説明 |
|---------|--------|------|
| 投稿 | `create_post` | ツイート作成（メディア・引用RT対応） |
| | `create_thread` | スレッド投稿 |
| | `delete_post` | ツイート削除 |
| | `get_post` | ツイート詳細取得 |
| | `get_post_history` | 投稿履歴・メトリクス |
| | `get_mentions` | メンション・リプライ取得 |
| | `reply_to_post` | リプライ送信 |
| | `search_posts` | ツイート検索 |
| | `schedule_post` | スケジュール投稿 |
| DM | `send_dm` | DM送信 |
| | `get_dm_conversations` | DM会話一覧 |
| | `get_dm_messages` | DM メッセージ履歴 |
| | `get_dm_events` | DMイベント取得 |
| ユーザー | `get_user` | ユーザー情報取得 |
| | `search_users` | ユーザー検索 |
| | `follow` / `unfollow` | フォロー/アンフォロー |
| | `get_followers` | フォロワー一覧 |
| ゲート | `create_engagement_gate` | エンゲージメントゲート作成 |
| | `list_engagement_gates` | ゲート一覧 |
| | `verify_gate` | ゲート条件検証 |
| | `process_gates` | ゲートポーリング手動実行 |
| キャンペーン | `create_campaign` | キャンペーン一括作成 |
| スタッフ | `list_staff` / `create_staff` | スタッフ管理 |
| | `update_staff` / `delete_staff` | スタッフ更新/削除 |
| ステップ | `create_step_sequence` | ステップ配信作成 |
| | `add_step_message` | ステップメッセージ追加 |
| | `enroll_user` | ユーザーをステップに登録 |
| 使用量 | `get_usage_summary` | API使用量サマリー |
| | `get_usage_daily` | 日次使用量 |
| | `get_usage_by_gate` | ゲート別使用量 |
| 無料収集 | `scrape_user_posts` | ユーザーの投稿+メトリクス取得(無料) |
| | `scrape_search` | X 検索 — top/latest/videos(無料) |
| | `scrape_post` | 単一ポストの全文・動画 embedUrl(無料) |
| | `scrape_user` | プロフィール・フォロワー数(無料) |
| Growth | `add_growth_source` / `list_growth_sources` | ネタ候補の登録・一覧 |
| | `save_growth_article` / `list_growth_articles` | 記事下書きの保存・一覧 |
| | `add_growth_draft` | 投稿ドラフトを承認キューへ |

## 5分デプロイガイド

### 前提条件

- Node.js 20+
- pnpm 9+
- [Cloudflare アカウント](https://dash.cloudflare.com/sign-up)
- [X Developer アカウント](https://developer.x.com/) (Pay-Per-Use 推奨)

### 1. X API アプリ設定

1. [X Developer Portal](https://developer.x.com/en/portal/projects-and-apps) でアプリを作成
2. **App permissions** を `Read, Write, and Direct Messages` に設定
3. 以下を控えておく:
   - **Consumer Key** / **Consumer Secret**
   - **Access Token** / **Access Token Secret**

### 2. リポジトリのセットアップ

```bash
git clone https://github.com/Shudesu/x-harness-oss.git
cd x-harness-oss
pnpm install
```

### 3. Cloudflare D1 データベース作成

```bash
npx wrangler d1 create x-harness
# 出力される database_id を apps/worker/wrangler.toml に記入

# スキーマを適用
npx wrangler d1 execute x-harness --file=packages/db/schema.sql
```

### 4. Workers のシークレット設定

```bash
npx wrangler secret put API_KEY   # ダッシュボードログイン用
```

### 5. Workers デプロイ

```bash
cd apps/worker
npx wrangler deploy
```

### 6. Xアカウント登録

```bash
# API経由でアカウントを登録
curl -X POST https://your-worker.workers.dev/api/x-accounts \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "xUserId": "YOUR_X_USER_ID",
    "username": "YOUR_USERNAME",
    "accessToken": "ACCESS_TOKEN",
    "accessTokenSecret": "ACCESS_TOKEN_SECRET",
    "consumerKey": "CONSUMER_KEY",
    "consumerSecret": "CONSUMER_SECRET"
  }'
```

### 7. 管理画面デプロイ

```bash
cd apps/web
NEXT_PUBLIC_API_URL=https://your-worker.workers.dev npx next build
npx wrangler pages deploy out --project-name=x-harness-admin
```

### 8. 動作確認

1. 管理画面にアクセスしてAPIキーでログイン
2. サイドバーで登録したアカウントが表示されることを確認
3. リプライページでメンションが取得できることを確認

## プロジェクト構成

```
x-harness/
├── apps/
│   ├── web/                # Next.js 管理画面
│   └── worker/             # Cloudflare Workers API
├── packages/
│   ├── db/                 # D1 スキーマ & クエリ
│   ├── sdk/                # TypeScript SDK (@x-harness/sdk)
│   ├── mcp/                # MCP Server (@x-harness/mcp)
│   ├── x-sdk/              # X API v2 ラッパー
│   ├── shared/             # 共有型定義
│   └── create-x-harness/   # CLI セットアップツール
└── docs/
    └── SPEC.md             # API仕様書
```

## コスト

| 利用状況 | 月額コスト |
|---------|-----------|
| ゲート1-2個（通常運用） | **$3-5** |
| バズ投稿（5,000+いいね） | $20-45 |
| インフラ (CF Free) | **$0** |

X API Pay-Per-Use プラン推奨。リプライトリガーアーキテクチャにより、`since_id` 差分取得でAPIコールを最小化。

**無料収集(twitter-cli)を使う場合**: 読み取りは **$0**。X API 課金は書き込みのみになります(目安: URL 入りポスト $0.20/件 — 動画引用投稿を1日3本で月 ≈ $18)。

## LINE Harness 連携

X Harness はクロスプラットフォームキャンペーンのための verify API を提供:

```
GET /api/engagement-gates/:id/verify?username=johndoe

{
  "eligible": true,
  "conditions": {
    "reply": true,
    "like": true,
    "repost": true,
    "follow": true
  }
}
```

キャンペーンウィザードを使えば、LINE Harness のフォーム作成・リンク生成まで自動化されます。

## ライセンス

MIT

---

## 開発者 / Author

**野田修一（Shudesu）** — Harness シリーズ（LINE Harness / IG Harness / X Harness）開発者、AIエージェント株式会社 代表

- GitHub: [@Shudesu](https://github.com/Shudesu)
- X: [@ai_shunoda](https://x.com/ai_shunoda)
- YouTube: [野田 修一 | The Harnessで0円](https://www.youtube.com/@ai_nodashuichi)
- 公式ドキュメント: [Harness Wiki](https://harness-wiki.pages.dev)
- 商用ツールとの比較・料金データ: [The Harness Lab](https://the-harness.com)
