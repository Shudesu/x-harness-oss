# AGENTS.md — X Harness (OSS)

このファイルは、このリポジトリで作業する AI コーディングエージェント（Claude Code, Codex 等）と人間のコントリビューター向けの開発ガイドです。PRの出し方の基本は `CONTRIBUTING.md` にもまとまっているので合わせて参照してください。プロダクト機能の説明は README.md、API仕様は `docs/SPEC.md` を参照してください。

## プロジェクト概要

X（旧Twitter）向けの完全オープンソース マーケティングオートメーション。Cloudflareの低コスト運用を前提に設計されており、エンゲージメントゲート（リプライ+いいね/リポスト/フォロー条件の検証）、キャンペーン管理、投稿・DM・フォロワー管理を提供する。TypeScript SDK と MCP Server を同梱し、AIエージェントからの自然言語操作を前提としている。姉妹プロジェクトの LINE Harness（line-harness-oss）と連携する verify API も持つ。

## 技術スタック

| レイヤー | 技術 |
|---|---|
| API | Cloudflare Workers + Hono |
| データベース | Cloudflare D1 (SQLite) |
| 管理画面 | Next.js 15 (App Router) + Tailwind CSS |
| SDK | TypeScript (ESM + CJS, tsup)、ゼロ依存 |
| MCP Server | `@modelcontextprotocol/sdk` ベース |
| X連携 | X API v2 + OAuth 1.0a |
| 定期実行 | Workers Cron Triggers (5分毎) |
| パッケージマネージャ | pnpm 9.15.4 (workspace) |

## モノレポ構成

```
apps/
  worker/                  Cloudflare Workers 本体（API + Cron）
    src/routes/            Hono ルートハンドラ（1ファイル1リソース: posts, dm, followers,
                            engagement-gates, campaigns, step-sequences, x-accounts, staff, usage,
                            verify, xaa, capabilities, articles, growth, growth-articles, growth-sources 等）
    src/services/          ビジネスロジック（engagement-gate判定・follower-sync・post-scheduler・
                            polling-scheduler・reply-trigger-cache・stealth制御等）
    src/middleware/        認証
  web/                     Next.js 15 管理画面
packages/
  db/                      D1 スキーマ (schema.sql) + クエリ関数群
  db/migrations/           連番マイグレーション（下記「DB変更の作法」参照）
  x-sdk/                   X API v2 の型付きラッパー (OAuth 1.0a)
  sdk/                     公開npmパッケージ `@x-harness/sdk`
  mcp/                     公開npmパッケージ `@x-harness/mcp`（MCP経由のAI操作用。scraper.ts / media.ts 等も含む）
  shared/                  共有型定義
  create-x-harness/        セットアップCLI（対話式デプロイ・DB作成・シークレット設定・スクレイパーセットアップを自動化）
docs/
  SPEC.md                  API仕様書
  LINE-HARNESS-INTEGRATION.md  LINE Harness との連携仕様（verify API）
  manual/                  運用マニュアル（無料章＋有料章の案内。有料章の本文はリポジトリに含まれない）
skills/
  x-growth-*/              Claude Code 向け Skill 定義（成長系ワークフロー用）
```

`articles` / `growth` / `growth-articles` / `growth-sources` / `xaa` 系のルートは記事生成・配信の成長機能群。触る前に対応する `apps/worker/src/routes/__tests__/*.test.ts` と `apps/worker/src/services/__tests__/*.test.ts` を必ず確認する（テストが最も信頼できる仕様書になっている領域）。

内部パッケージ名は一貫して `@x-harness/*` 名前空間（`db`, `x-sdk`, `shared`, `sdk`, `mcp`）。line-harness-oss と異なり内部/公開で名前空間が分かれていないので、新規パッケージもこの命名に合わせる。

## セットアップ（コントリビュート用）

```bash
# 自分の fork を clone
git clone https://github.com/<your-username>/x-harness-oss.git
cd x-harness-oss
pnpm install

# ローカル D1 + マイグレーション
pnpm db:migrate:local

# Worker 起動
pnpm dev:worker           # http://localhost:8787
# 管理画面起動
cd apps/web && pnpm dev   # http://localhost:3000
```

Worker のローカル環境変数は `apps/worker/.dev.vars`（gitignore対象。`.dev.vars.example` をコピーして作成）。

## テスト・型チェック

```bash
pnpm build                # 全パッケージビルド (pnpm -r build)
pnpm test                 # vitest run（対象は apps/worker/src/**/*.test.ts, packages/*/src/**/*.test.ts）
pnpm typecheck             # 全パッケージ型チェック (pnpm -r typecheck)
```

テストは `apps/worker/src/routes/__tests__/`・`apps/worker/src/services/__tests__/` に配置する。新しいルート/サービスを追加する場合は同じ場所にユニットテストを添えることを推奨。

## DB変更の作法

- `packages/db/schema.sql` は初期スキーマ。既存環境への変更（カラム追加・制約変更等）は `packages/db/migrations/NNN-description.sql` の形式（3桁連番・ケバブケース）で新規追加する。既存のマイグレーションファイルは変更しない
- 新しいマイグレーションを追加したら `package.json` に `db:migrate:NNN` / `db:migrate:NNN:local` の script を追加するのがこのリポジトリの慣習（既存の `db:migrate:004`, `db:migrate:018` 等を参照）
- クエリは `packages/db/src/*.ts` の関数経由でアクセスする。ルートハンドラに生SQLを直書きしない

## コーディング規約

- TypeScript strict モード・ESM
- Hono のルートハンドラ（`apps/worker/src/routes/*.ts`）は薄く保ち、業務ロジックは `apps/worker/src/services/*.ts` に分離する
- Cron による定期処理（リプライ検出・フォロワースナップショット・引用RT取込）は `since_id` を使った差分取得を徹底し、X API呼び出し回数（コスト）を増やす変更をしない
- ステルス設計（ジッター・レート制限・メッセージバリエーション）に関わる変更は `services/stealth.ts` の既存パターンを踏襲する

## シークレット・設定の扱い（重要）

- `apps/worker/wrangler.toml` の `database_id` はプレースホルダー（`YOUR_D1_DATABASE_ID`）。実際のCloudflareリソースIDに書き換えたまま **コミットしない**
- シークレット（`API_KEY`, `X_ACCESS_TOKEN`, `X_REFRESH_TOKEN` 等）は `wrangler secret put` で設定するものであり、リポジトリ内のどのファイルにも平文で書かない
- PRを出す前に、diff に実際のCloudflareアカウントID・D1データベースID・X APIの認証情報が紛れ込んでいないか必ず確認する

## コントリビュート手順

1. リポジトリを fork し、機能ブランチを作成する
2. `pnpm install` → 変更 → `pnpm build && pnpm typecheck`（該当パッケージのテストがあれば `pnpm test`）
3. 影響範囲を絞った PR を送る。大きな破壊的変更・大規模リファクタは事前に Issue で相談する
4. PR の説明文にシークレットや個人のX/Cloudflareアカウント情報を書かない
5. API仕様に関わる変更は `docs/SPEC.md` も合わせて更新する
