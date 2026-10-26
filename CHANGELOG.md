# Changelog

## [0.6.0] - 2026-10-26

- 画面・API・配布メタデータのバージョンを統一し、`0.0.0`表示を修正。
- 予約時刻・二重投稿防止、認可・秘密情報・セッション・OAuthの修正。
- 任意のGrok連携、支出台帳、予算ガード、DM配布設定を追加。
- LINEキャンペーンの追跡リンク作成、導入ガイドのCSP、OAuthコールバック案内を修正。
- 型チェック・テスト・ビルド・依存監査・DBマイグレーション・配信dry-runをリリース条件に追加。
- **更新時にmigration 019、ENCRYPTION_KEY、ADMIN_ORIGINと公開APIの呼び出し側変更が必要です。**

詳細: [v0.6.0 リリースノート](docs/releases/v0.6.0.md)

## [0.5.1] - 2026-04-10

画像添付・複数画像削除時のUI、CLIのCorepackエラーを修正。
[公開リリース](https://github.com/Shudesu/x-harness-oss/releases/tag/v0.5.1)

## [0.5.0] - 2026-04-10

蓄積型返信キャッシュ、verify条件拡張、APIコストゲート、投稿削除を追加。
[公開リリース](https://github.com/Shudesu/x-harness-oss/releases/tag/v0.5.0)

## [0.4.0] - 2026-04-07

キャンペーン別の流入・特典テンプレートと追跡リンク連携を追加。LINE Harness v0.10.0以上が必要。
[公開リリース](https://github.com/Shudesu/x-harness-oss/releases/tag/v0.4.0)

## [0.3.0] - 2026-04-05

ダッシュボードPhase 2、メッセージ・返信・キャンペーン管理、MCP機能を追加。
[公開リリース](https://github.com/Shudesu/x-harness-oss/releases/tag/v0.3.0)

過去の内部変更ノートは[アーカイブ](docs/archive/changelog-before-release-reconciliation.md)に保存しています。公開タグの日付・内容と異なる記載があったため、上記の公開履歴はGitHub Releaseの実データに合わせました。
