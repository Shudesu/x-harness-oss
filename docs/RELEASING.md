# リリース手順

X Harness を GitHub / npm に公開するときの手順。認証が必要な操作はローカルで実行する。

## 前提: 認証

このマシンの `gh` CLI は現在 `4uudream-ai` でログインしており、`Shudesu/x-harness-oss` への push 権限がない。リポジトリ所有アカウントで認証を追加する:

```bash
# Shudesu アカウントを追加ログイン（ブラウザ認証）
gh auth login --hostname github.com

# アカウント切替
gh auth switch --hostname github.com --user Shudesu
```

npm はログインしていない状態。`@x-harness` スコープの owner アカウントで:

```bash
npm login
```

## 1. GitHub push

```bash
git push origin main
```

## 2. npm publish（3パッケージ）

`prepublishOnly` で publish 前に自動ビルドされる。スコープ付きパッケージは `publishConfig.access: public` 設定済み。

```bash
pnpm --filter @x-harness/sdk exec npm publish
pnpm --filter @x-harness/mcp exec npm publish
pnpm --filter create-x-harness exec npm publish
```

初回のみ: npm に `x-harness` organization を作成しておくこと（https://www.npmjs.com/org/create）。

## 3. バージョンタグ

```bash
git tag v0.5.2 && git push origin v0.5.2
```

## 注意

- `apps/worker/wrangler.toml` の `database_id` は本番 D1 の実IDに書き換えた状態がローカルにあるが、**コミットしない**（公開リポジトリはプレースホルダのまま）。`git status` に常に modified で残るのは意図的。
- `.env.local` / `.claude/` は `.gitignore` 済み。
