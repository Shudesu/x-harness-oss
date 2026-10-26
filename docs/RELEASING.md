# リリース手順

製品の版番号はルート`package.json`を基準とします。Web/Workerのpackage.json、画面とAPIの共通定数、公開`version.json`、CHANGELOG、リリースノートを一致させます。npmのMCP/SDK/セットアップCLIはChangesetsで別管理します。

## 通常の更新

1. バグ修正だけならpatch（例: 0.6.1）、機能追加・0.xの互換性変更はminor（例: 0.7.0）を選びます。既存タグは動かしません。
2. `pnpm release:prepare 0.6.1`を実行し、`docs/releases/v0.6.1.md`とCHANGELOGを更新します。ノートの先頭は`# v0.6.1 — 説明`にします。破壊的変更・移行手順・未検証範囲を記載します。
3. `pnpm release:check`を実行し、PRを作成します。GitHubのCIではローカルD1への実適用とWorker dry-runも行います。ブラウザ擬似操作や本番送信は行いません。
4. CIが成功したPRをmainへマージし、対象コミットを確定します。
5. 検証済みコミットに注釈付きタグを作成してpushします。

```sh
git fetch origin main --tags
git tag -a v0.6.1 <検証済みmainのコミット> -m 'X Harness v0.6.1'
git push origin refs/tags/v0.6.1
```

Release workflowが再検証し、タグと版番号の一致、注釈付きタグ、mainの履歴内のコミットであることを確認してからGitHub Releaseを公開します。失敗時は公開されません。認証やCI障害を直した後は同じタグのworkflowを再実行できます。公開済みリリースは自動で上書きしません。

## 配信との区別

GitHub Releaseはソースの配布記録です。Cloudflareのデプロイ、既存D1の更新、鍵の変更、npm公開は自動実行しません。それぞれ対象環境と承認範囲を確認して行います。`/api/health`と管理画面の版番号、`/version.json`で配信されたソースの版を照合します。

バグゼロを保証する運用ではなく、リリース前に検出する自動チェック、再現テスト、変更履歴、復旧時に特定できるタグを維持する運用です。
