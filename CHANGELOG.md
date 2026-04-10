# Changelog

## [0.5.0] - 2026-04-10

### Added
- **蓄積型リプライヤーキャッシュ** — UPSERT で削除しない累積キャッシュ、verify miss 時の自動リフレッシュ
- **verify 条件拡張** — repost / like / reply 各トリガーに対応、失効キャッシュからの再チェック
- **API コストゲート** — エンドポイント別コスト計算、高コストページの自動フェッチ無効化
- **投稿ハードデリート** — ダッシュボードからポスト済みツイートの完全削除
- **create-x-harness CLI v0.2.3** — 3ステップ式プロンプト、英語ユースケースサンプル、LINE Harness ダッシュボード連携、corepack 署名エラー修正

### Changed
- デフォルトトリガーを reply → repost に変更
- ナビバーのラベルをリネーム、自動機能をデフォルトOFFに変更
- README の競合名を伏せ字に変更

### Fixed
- セットアップページの不要要素をクリーンアップ
- キャンペーンのデフォルトトリガー不整合を修正
- 投稿ページのコストゲート表示を修正
- CLI: corepack 署名検証エラー（Node 22+）を修正 — `ensurePnpm` 共通ヘルパー導入
- CLI: CF Pages プロジェクト suffix から apiKey prefix を除去
- CLI: LINE Harness 接続のダッシュボード登録漏れを修正

## [0.4.0] - 2026-04-07

### Added
- **read-through リプライヤーキャッシュ** — verify エンドポイントでのキャッシュ読み込み
- **CLI ウィザード v0.2.2** — セットアップページ追加、pnpm bootstrap 対応

### Fixed
- X Harness の課金に関する誤解を修正（無料であることを明記）

## [0.3.0] - 2026-04-05

### Added
- **管理画面 Phase 2** — ダッシュボード全面リニューアル
  - グローバルアカウント切替（サイドバーで選択、全ページ連動）
  - DM管理ページ（プロフィール表示、検索、ページネーション、E2E暗号化注記）
  - リプライ管理ページ（元ツイート表示、ワンクリックいいね/リポスト/返信、自分のリプライ表示）
  - 引用ツイートページ（自動検出、DB永続化、引用RTアクション、メトリクス表示）
  - キャンペーンウィザード（投稿→条件→LINE連携→プレビューの4ステップ）
  - 投稿管理ページ（メディアアップロード、Premium文字数制限対応）
  - API使用量ページ（エンドポイント別、ゲート別、日次チャート）
  - スタッフ管理ページ（4ロール RBAC）
- **フォロワー数トラッキング** — 日次 cron スナップショット、推移グラフ、7日/30日増減
- **エンゲージメントアクション永続化** — いいね/リポスト/返信状態をDBに記録、リロードしても復元
- **引用ツイート DB 永続化** — X API 7日制限を超えて引用RTを蓄積
- **MCP ツール拡張** — 30ツールに拡張（DM、スタッフ、使用量、キャンペーン）
- **メディアアップロード** — 画像/動画対応、MP4は自動で `tweet_video` カテゴリ
- **X Activity API (XAA)** — Webhook 受信 + サブスクリプション管理
- **LINE Harness 連携強化** — キャンペーンウィザードで URL/API Key 直接入力、フォーム自動作成

### Security
- API Key 漏洩防止（LINE Harness API Key、Staff API Key のブラウザ露出を修正）
- Webhook バイパス修正（`_webhookVerified` クライアント送信防止）
- Staff RBAC 強化（viewer ロールの mutating 操作をブロック）
- QR コードプロキシ（ref トークンの第三者漏洩防止）
- エンゲージメントゲートから `line_harness_api_key` 除外

### Fixed
- Subscription ルートパス不一致（全404だった問題を修正）
- DM 送信レスポンス形状を DmMessage に統一
- Usage パラメータ名不一致（from/to → startDate/endDate/days）
- MCP reply_to_post / get_usage_summary のエンドポイント修正
- Daily usage ソート順を ASC に修正
- `{link}` プレースホルダーの未置換防止
- .env.production 追加で localhost フォールバック防止

## [0.2.0] - 2026-04-01

### Added
- Reply-trigger architecture with cached condition verification
- Verify API endpoint for LINE Harness integration
- Multi-condition gates (reply + like + repost + follow)
- Dashboard UI for reply-trigger gate creation

### Changed
- Engagement gate processing now uses `since_id` for reply detection
- Reduced X API costs from ~$86/mo to ~$3-5/mo per gate

### Fixed
- Removed hardcoded personal URL from MCP server

## [0.1.0] - 2026-03-26

### Added
- Initial MVP: Engagement Gates, Follower Management, Tags
- Scheduled Posts, Step Sequences
- TypeScript SDK, MCP Server, Dashboard
- Stealth design (jitter, rate limiting, template variation)
- LINE Harness integration (one-way tagging)
