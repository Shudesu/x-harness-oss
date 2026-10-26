# LINE先行キャンペーンの検証記録

2026-10-27。実X/LINEへの投稿・送信や本番DB更新は行っていません。

- 17ファイル、201テスト成功。型チェック・lint成功。
- Web、SDK、CLI、MCPビルド成功。静的配布物の表示が`0.7.0`であることを照合。
- migration/bootstrap一致、SQLite integrity、旧配布・トークンの保持を確認。
- 実workerdのHTTPスモークで、1200×630 PNG、HMAC署名claim、Durable Object、D1在庫確定を確認。
- 対応LINE repoとのHTTP契約テスト成功。本人以外のID指定拒否、合言葉発行、X照合、先着確定、LINE proxy通知、再送時の重複抑止を確認。
- production依存監査の既知警告0件。Satori/YogaのWASM整合とライセンスを確認。

追加回帰テストはコード衝突・期限切れ再発行・コピー・同時刻の数値ID順・遅れて届く早い投稿・ページング期間の保持・予算待機・在庫/outboxの同時ロールバック・他者投稿を自社投稿キャッシュに混ぜないことを対象にしています。

```sh
pnpm release:check
node scripts/smoke-gates.mjs
LINE_GATE_REPO=/path/to/matching/line-checkout pnpm exec vitest run --config vitest.cross.config.ts
```

ビルドでは既存ESLint設定に対するNextプラグインの警告が出ますが、型チェック・lint・ビルド自体は成功しています。実機、実OAuth/Turnstile、実課金、本番移行は未実施です。未検証範囲と運用上の限界は[移行ガイド](line-first-gates.md)を参照してください。
