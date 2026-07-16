---
name: x-growth-video
description: 海外の動画バズを発見し、/video/1 URL で元動画を自分のツイート内に展開する動画引用投稿を生成・予約する。承認モード(デフォルト)とフルオートモード(--auto)。トリガー: 動画投稿, 動画ネタ, 動画引用, video, バズ動画
---

# X Growth: 動画引用投稿

動画は現在の X で最もインプレッションが出るフォーマット。このスキルは海外の動画バズを発見し、`https://x.com/<author>/status/<id>/video/1` 形式の URL を本文に貼ることで**元動画を自分のツイート内に展開**する投稿を作る(再アップなし・元投稿へのクレジット付き)。

## モード

- **承認モード(デフォルト)**: ドラフトを `add_growth_draft` で承認キューへ → ダッシュボードで ok/編集 → 予約
- **フルオートモード(`--auto` と明示された場合のみ)**: `schedule_post` で直接予約する。1回の実行で最大 3 本まで。

## 前提

- X Harness MCP セットアップ済み + twitter-cli(TWITTER_AUTH_TOKEN / TWITTER_CT0、サブアカウント推奨)
- コスト注意: 投稿(write)は X API 課金。URL 入りポストは $0.20/件(2026-07 時点)

## 手順

1. **発見** — `scrape_search` を `type: "videos"`, `lang: "en"`, `minLikes: 1000〜5000` で実行。ユーザーのジャンルに合うクエリを 3〜10 個回す。`list_growth_sources` で登録済みのものは除外。
2. **動画情報取得** — 候補ごとに `scrape_post` で全文と `embedUrl` を取得。`embedUrl` が null(動画なし)の候補は捨てる。
3. **口調学習** — `scrape_user_posts` でユーザー自身の直近投稿を取得し、文体を合わせる(初回のみでよい。学習結果を会話内で再利用してよい)。
4. **文面生成** — 各候補につき 150〜400 字:
   - 1 行目: 価値が一目でわかる強フック(無料/公式/具体的数字が強い)
   - 空行 → 内容の分解(「内容はこんな感じ:」+ 箇条書き 3〜5 点)
   - ひとこと感想 or 読者への問いかけ
   - 末尾: `via @<author>` + embedUrl(この URL が動画として展開される)
   - 本文にそれ以外のリンクは入れない(リーチが下がる)
5. **ピラー紐付け(任意)** — ユーザーがピラー投稿(自分の代表記事ポスト)を設定している場合、テーマが一致すれば `quoteTweetId` にピラー投稿 ID を指定(引用RT×動画のダブル構造)。
6. **予約**:
   - 承認モード: `add_growth_draft`(type: "video", scheduledAt は **YYYY-MM-DDTHH:MM:SS+09:00 形式必須**)
   - フルオート: `schedule_post` で同形式の scheduledAt。投稿時刻は 7:00〜22:00 (JST) に分散させる
7. **報告** — 作成本数・予約時刻・(承認モードなら)ダッシュボードでの承認が必要なことを伝える。

## 定期実行(cron)

ユーザーが毎日自動で回したい場合の設定例を案内する:

```bash
# Claude Code
30 5 * * * cd /path/to/project && claude -p "/x-growth-video --auto" --dangerously-skip-permissions

# Codex CLI
30 5 * * * cd /path/to/project && codex exec "x-growth-video スキルを --auto で実行"
```

## 品質・安全基準

- 元投稿者のクレジット(via @author)必須
- 同じ投稿者ばかり連続で使わない(1日の中で分散)
- 政治・センシティブ・真偽不明の動画は選ばない
- フルオートでも 1 実行 3 本まで(スパム判定回避)
