以下を、Codexへ渡すための**実装仕様書 v0.1**として整理しました。X Harness OSSの現行構成、Hermes Agentの継続実行機能、Codexによるリポジトリ編集・コマンド実行を前提にしています。X Harness OSSにはMCP連携、投稿・DM・反応管理などが含まれますが、本仕様ではファンアカウントに不要な自動DM・自動反応機能を原則無効化します。

# CUBΣLICファンアカウント運用OS  
## Codex・Hermes Agent・X Harness OSS統合仕様書 v0.1

**対象Xアカウント:** `@tubelic_cube`  
**対象サイト:** `cubelic-fan.com`  
**作成日:** 2026-07-21  
**ステータス:** Draft for Implementation  
**実装主体:** Codex  
**運用エージェント:** Hermes Agent  
**X実行基盤:** X Harness OSS  
**対象フェーズ:** Phase 1〜3

---

# 0. 文書の目的

本仕様書は、CUBΣLICの非公式ファンアカウント `@tubelic_cube` において、以下を実現するためのシステム要件を定義する。

1. ライブ映像、セットリスト、ライブ予定などの一次情報を迅速に整理する
2. 新規ファンがCUBΣLICを知り、ライブへ参加するまでの導線を作る
3. 投稿作成・予約・分析の負担を軽減する
4. 非公式ファンアカウントとしての人間味と信頼性を維持する
5. 撮影権利、映り込み、誤投稿、過度な自動化によるリスクを抑える
6. 投稿の量ではなく、来場・関心・コミュニティ形成への寄与を最適化する

本システムは単純なX自動投稿ツールではない。

以下の機能を持つ**ファンコミュニティ運用OS**として構築する。

```text
戦略策定
  ↓
コンテンツ計画
  ↓
素材・権利確認
  ↓
投稿案作成
  ↓
人間による承認
  ↓
予約・投稿
  ↓
効果測定
  ↓
改善提案
```

---

# 1. 基本方針

## 1.1 中核原則

本システムは以下を原則とする。

### P-01 人間承認原則

ライブ映像、メンバー名を含む投稿、感想、評価表現を含む投稿は、必ず人間が本文を確認する。

Hermesは下書き作成までを担当し、原則として自動公開しない。

### P-02 戦略と実行の分離

Hermes自身にマーケティング戦略を自由生成させない。

戦略は設定ファイルとして管理し、Hermesはその範囲内で処理する。

### P-03 非公式ファンアカウント原則

公式運営、メンバー本人、所属事務所と誤認される表現を使用しない。

公式発表と個人の感想を明確に区別する。

### P-04 権利優先原則

撮影可否、掲載可否、映り込み確認が取れていない素材は投稿しない。

### P-05 品質優先原則

投稿数の達成より、内容、鮮度、権利、安全性を優先する。

### P-06 自動反応禁止原則

以下を実装または有効化しない。

- 自動いいね
- 自動フォロー
- 自動フォロー解除
- 無差別な自動返信
- 自動DM
- フォローやリポストを条件とした自動配布
- Cookieを利用した非公式な大量スクレイピング
- 他者動画の無断取得・再投稿

Xでは自動化された活動にもXルールと開発者ポリシーが適用され、利用者は接続した第三者アプリの挙動についても責任を負う。自動フォロー・解除などは禁止対象として明示されているため、本仕様では実装対象外とする。

---

# 2. システム目標

## 2.1 編集ミッション

本システムの最上位目的は以下とする。

> CUBΣLICを初めて知った人が、魅力を理解し、不安なくライブに参加できるよう、正確で役立つ一次情報を整理して届ける。

この編集ミッションは、アルゴリズムによる自動最適化対象にしない。

月1回、人間がレビューする。

評価項目は以下とする。

- 初めての人の不安を減らせたか
- ライブ参加への心理的ハードルを下げたか
- CUBΣLICの魅力を正確に伝えたか
- メンバーや運営への敬意を維持したか
- ファンコミュニティに役立つ情報だったか
- 投稿が業者的または機械的になっていないか

---

## 2.2 North Star Metric

主たるNorth Star Metricは以下とする。

```text
CUBΣLICの初回来場につながる行動数
```

初回来場そのものを直接計測できない場合、以下を代理指標とする。

```text
ライブ予定ページへの有効流入数
```

有効流入とは、以下の条件のいずれかを満たすセッションとする。

- ライブ予定ページを20秒以上閲覧
- チケットリンクをクリック
- 初心者ガイドからライブ予定ページへ遷移
- 同一セッション内で2ページ以上閲覧

---

## 2.3 主KPI

Phase 1の主KPIは2個に限定する。

### KPI-01 月間新規フォロー数

```text
monthly_new_followers
```

### KPI-02 ライブ予定ページへの有効流入数

```text
qualified_calendar_visits
```

補助KPIは以下とする。

- 動画再生完了率
- プロフィール表示数
- 投稿からのリンククリック数
- 初心者ガイド閲覧数
- メンバー紹介ページ閲覧数
- YouTube遷移数
- Spotifyプレイリスト遷移数
- 投稿への有意味な返信数
- 引用投稿数
- セットリスト速報の公開所要時間

表示回数やいいね数は単独の成功指標として使用しない。

---

# 3. ファンジャーニー

## 3.1 ファン心理ステージ

投稿ごとに以下のいずれかの対象ステージを設定する。

| コード | ステージ | 状態 |
|---|---|---|
| `unaware` | 未認知 | CUBΣLICを知らない |
| `aware` | 認知 | 名前や映像を一度見た |
| `interested` | 興味 | 曲、メンバー、ライブに関心がある |
| `first_visit_intent` | 初参加検討 | ライブへ行くことを検討している |
| `first_visitor` | 初回来場 | 初めて現場に来た |
| `repeat_fan` | リピーター | 2回以上参加している |
| `advocate` | 布教層 | 他人に紹介・共有している |

## 3.2 ステージ別コンテンツ

| ステージ | 主なコンテンツ |
|---|---|
| `unaware` | 強いライブ短尺、印象的なメンバーカット |
| `aware` | 曲の魅力、グループの特徴、メンバー紹介 |
| `interested` | セットリスト、フル尺、ライブレポ |
| `first_visit_intent` | 初心者ガイド、会場、チケット、特典会案内 |
| `first_visitor` | 当日の流れ、持ち物、撮影ルール |
| `repeat_fan` | セトリ履歴、次回予定、深掘りコンテンツ |
| `advocate` | 共有しやすいまとめ、引用しやすい動画、紹介素材 |

Hermesは、投稿文を生成する前に必ず対象ステージを確定する。

---

# 4. コンテンツ戦略

## 4.1 コンテンツカテゴリ

以下を標準カテゴリとする。

| コード | 内容 | 主目的 |
|---|---|---|
| `live_digest` | ライブ全体の短尺映像 | 認知 |
| `member_focus` | メンバー個人の見せ場 | 推し入口 |
| `song_focus` | 曲の魅力や見どころ | 興味 |
| `setlist_flash` | 終演直後のセットリスト速報 | 速報・検索 |
| `setlist_archive` | 過去セトリ整理 | 保存・検索 |
| `beginner_guide` | 初参加向け情報 | 来場不安軽減 |
| `event_notice` | ライブ予定・予約案内 | 動員 |
| `event_reminder` | 開催前リマインド | 動員 |
| `member_profile` | メンバー紹介 | 興味・推し |
| `youtube_notice` | YouTube本編案内 | 長尺視聴 |
| `playlist_notice` | Spotifyプレイリスト案内 | 楽曲接触 |
| `community_question` | 会話を促す質問 | コミュニティ |
| `weekly_summary` | 1週間まとめ | 再接触 |
| `evergreen` | 長期間有効な情報 | 検索資産 |
| `correction` | 訂正・補足 | 信頼維持 |

---

## 4.2 中核差別化機能

本システムの中核差別化機能は以下とする。

```text
終演
  ↓
セットリスト入力または取得
  ↓
既存GASパイプラインでJSON化
  ↓
LP更新
  ↓
Spotifyプレイリスト更新
  ↓
Hermesがセットリスト速報案を生成
  ↓
映像があればダイジェストと関連付け
  ↓
人間承認
  ↓
X投稿
```

これを`Setlist Flash Pipeline`と呼ぶ。

目標SLAは以下とする。

| 条件 | 目標 |
|---|---|
| セトリデータ確定 | 終演後30分以内 |
| LP更新 | セトリ確定後10分以内 |
| X速報下書き生成 | LP更新後5分以内 |
| 最初の速報投稿 | 原則として終演後60分以内 |
| ダイジェスト映像 | 当日中または翌日午前中 |

SLA未達は失敗ではない。

権利、安全性、正確性を優先する。

---

## 4.3 Evergreenと速報の区別

各コンテンツは以下のいずれかを持つ。

```yaml
content_lifecycle:
  type: news | evergreen | hybrid
```

### `news`

短期間で価値が低下する。

例:

- 終演直後のセトリ
- 当日のライブ映像
- 明日のイベント告知

### `evergreen`

長期間利用できる。

例:

- 初心者ガイド
- メンバー紹介
- 特典会の流れ
- 持ち物
- 撮影ルールの確認方法

### `hybrid`

速報として公開後、アーカイブ資産にもなる。

例:

- セットリスト
- ライブレポ
- 楽曲紹介

---

# 5. 投稿ポートフォリオ

## 5.1 基準比率

4週間単位の目安を以下とする。

| カテゴリ群 | 比率目安 |
|---|---:|
| ライブ映像・メンバー映像 | 35% |
| 初心者向け・Evergreen | 20% |
| セットリスト・一次情報 | 15% |
| ライブ予定・動員 | 15% |
| メンバー・楽曲紹介 | 10% |
| コミュニティ会話 | 5% |

比率は厳密なノルマではない。

Hermesは不足カテゴリを提案するが、投稿数を埋めるための低品質投稿は生成しない。

---

## 5.2 連続投稿制約

以下を禁止する。

- 同一メンバーの投稿が4件以上連続する
- ライブ動画だけが5件以上連続する
- 告知投稿だけが3件以上連続する
- 類似文面を72時間以内に再利用する
- 同一動画を意図せず再投稿する
- 同一リンクを短時間に繰り返す

---

# 6. イベント中心設計

## 6.1 イベント状態

各ライブイベントは以下の状態を持つ。

```text
draft
  ↓
announced
  ↓
ticket_open
  ↓
upcoming
  ↓
event_day
  ↓
in_progress
  ↓
ended
  ↓
setlist_confirmed
  ↓
digest_ready
  ↓
archived
```

## 6.2 状態別投稿

| 状態 | 投稿候補 |
|---|---|
| `announced` | 開催情報 |
| `ticket_open` | 予約開始 |
| `upcoming` | 初心者向け案内、見どころ |
| `event_day` | 当日案内、会場、撮影規定 |
| `ended` | 終演速報 |
| `setlist_confirmed` | セトリ速報 |
| `digest_ready` | ライブダイジェスト |
| `archived` | 振り返り、YouTube、プレイリスト |

Hermesはイベント状態に不整合がある場合、投稿案を生成しない。

---

# 7. システムアーキテクチャ

## 7.1 論理構成

```text
┌──────────────────────────┐
│ Human Operator           │
│ 方針決定・本文修正・承認 │
└────────────┬─────────────┘
             │
┌────────────▼─────────────┐
│ Strategy / Content Planner│
│ KPI・配分・対象・ルール   │
└────────────┬─────────────┘
             │
┌────────────▼─────────────┐
│ Hermes Agent             │
│ 継続処理・素材確認・生成 │
└──────┬─────────────┬─────┘
       │             │
┌──────▼──────┐ ┌────▼────────┐
│ Source APIs │ │ Local Assets │
│ GAS / LP    │ │ Resolve      │
│ Calendar    │ │ Video / JSON │
└──────┬──────┘ └────┬────────┘
       └──────┬───────┘
              │
┌─────────────▼────────────┐
│ Content Registry         │
│ D1 / SQLite / JSON       │
└─────────────┬────────────┘
              │
┌─────────────▼────────────┐
│ X Harness OSS            │
│ Draft / Schedule / Post  │
│ Metrics                  │
└─────────────┬────────────┘
              │
┌─────────────▼────────────┐
│ X                        │
└─────────────┬────────────┘
              │
┌─────────────▼────────────┐
│ Analytics / Review       │
└──────────────────────────┘
```

## 7.2 責務分担

### Codex

Codexは構築・改修・テスト・レビューを担当する。

- リポジトリの作成
- X Harness OSS導入
- Hermes接続
- MCP設定
- スキーマ作成
- API実装
- テスト作成
- CI/CD構築
- マイグレーション
- 監査ログ実装
- 仕様との差分確認
- セキュリティレビュー
- Skillのレビュー

Codex CLIはローカルリポジトリを調査し、ファイル編集とコマンド実行ができ、スクリプトやCIから`codex exec`として呼び出すこともできる。

### Hermes Agent

Hermesは継続的な運用処理を担当する。

- 新規イベントの確認
- Resolve書き出しフォルダの確認
- JSONメタデータの検証
- セットリスト更新の検知
- 投稿候補の生成
- 重複確認
- X Harnessへの下書き登録
- 投稿後メトリクス取得
- 日次・週次レポート作成
- 要確認キューの作成

HermesにはCron、継続状態、タスク再試行、チェックポイント等が存在するが、本仕様ではXへの直接投稿権限を与えない。

### X Harness OSS

X Harness OSSはXとの接続と実行を担当する。

- 下書き保存
- 予約投稿
- 投稿実行
- 投稿ID保存
- 反応データ取得
- API利用量記録
- 投稿履歴管理

DM、エンゲージメントゲート、自動リプライ関連機能は無効化する。

---

# 8. リポジトリ構成

Codexは以下を基本構成としてリポジトリを作成する。

```text
cubelic-content-os/
├── AGENTS.md
├── README.md
├── SPEC.md
├── LICENSE
├── .env.example
├── package.json
├── pnpm-workspace.yaml
├── docker-compose.yml
├── apps/
│   ├── planner-api/
│   ├── approval-ui/
│   └── analytics-dashboard/
├── services/
│   ├── hermes-bridge/
│   ├── x-harness-adapter/
│   ├── setlist-ingestor/
│   ├── media-validator/
│   ├── rights-validator/
│   ├── url-builder/
│   └── metrics-collector/
├── packages/
│   ├── schemas/
│   ├── domain/
│   ├── content-rules/
│   ├── prompt-templates/
│   ├── logger/
│   └── test-fixtures/
├── config/
│   ├── strategy.yaml
│   ├── content-mix.yaml
│   ├── destinations.yaml
│   ├── rights-policy.yaml
│   ├── approval-policy.yaml
│   ├── account-profile.yaml
│   └── crisis-policy.yaml
├── skills/
│   ├── generate-post/
│   ├── ingest-setlist/
│   ├── inspect-media/
│   ├── collect-metrics/
│   ├── weekly-review/
│   └── incident-response/
├── migrations/
├── scripts/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── contract/
│   └── e2e/
└── docs/
    ├── operations.md
    ├── incident-response.md
    ├── content-guidelines.md
    └── data-dictionary.md
```

---

# 9. データモデル

## 9.1 Content Item

```json
{
  "content_id": "cnt_20260721_001",
  "event_id": "evt_20260721_example",
  "category": "setlist_flash",
  "target_stage": "interested",
  "content_lifecycle": {
    "type": "hybrid",
    "expires_at": null
  },
  "status": "draft",
  "source_type": "setlist_json",
  "source_refs": [],
  "member_ids": [],
  "song_ids": [],
  "emotion_tags": [
    "exciting"
  ],
  "destination": {
    "type": "setlist_page",
    "base_url": "https://cubelic-fan.com/setlists/example",
    "tracked_url": ""
  },
  "created_at": "2026-07-21T12:00:00+09:00",
  "updated_at": "2026-07-21T12:00:00+09:00"
}
```

## 9.2 Event

```json
{
  "event_id": "evt_20260721_example",
  "title": "イベント名",
  "venue": "会場名",
  "starts_at": "2026-07-21T19:00:00+09:00",
  "ends_at": "2026-07-21T20:30:00+09:00",
  "state": "ended",
  "official_url": "",
  "ticket_url": "",
  "event_tags": [],
  "filming_policy": {
    "confirmed": false,
    "scope": "unknown",
    "evidence_type": null,
    "evidence_url": null,
    "confirmed_at": null,
    "confirmed_by": null,
    "notes": null
  }
}
```

## 9.3 Media Asset

```json
{
  "asset_id": "ast_20260721_001",
  "event_id": "evt_20260721_example",
  "path": "/exports/20260721/clip01.mp4",
  "sha256": "",
  "duration_seconds": 24.8,
  "orientation": "vertical",
  "resolution": "1080x1920",
  "audio_present": true,
  "rights": {
    "filming_policy_confirmed": true,
    "publishing_allowed": true,
    "evidence_url": "",
    "song_scope_confirmed": true
  },
  "privacy": {
    "audience_visible": false,
    "third_party_faces_detected": false,
    "manual_review_completed": true,
    "cropping_required": false,
    "blurring_required": false
  },
  "quality": {
    "video_ok": true,
    "audio_ok": true,
    "sync_ok": true,
    "score": 86
  },
  "status": "approved_for_draft"
}
```

## 9.4 Draft Post

```json
{
  "draft_id": "drf_20260721_001",
  "content_id": "cnt_20260721_001",
  "account_id": "tubelic_cube",
  "text": "投稿本文",
  "media_asset_ids": [],
  "category": "setlist_flash",
  "template_id": "setlist_flash_v1",
  "template_version": "1.0.0",
  "target_stage": "interested",
  "emotion_tags": [
    "informative"
  ],
  "hashtags": [
    "CUBΣLIC"
  ],
  "destination_url": "",
  "utm": {
    "source": "x",
    "medium": "social",
    "campaign": "event_20260721_example",
    "content": "setlist_flash_v1"
  },
  "quality_score": 88,
  "freshness_score": 91,
  "rights_gate": "passed",
  "approval_status": "pending",
  "scheduled_at": null,
  "published_post_id": null
}
```

---

# 10. 権利・プライバシー管理

## 10.1 必須フィールド

ライブ映像を含む投稿では以下を必須とする。

```yaml
filming_policy:
  confirmed: true
  scope: full_event | selected_songs | selected_time | other
  evidence_type: official_x | official_site | venue_notice | staff_confirmation
  evidence_url: string
  confirmed_at: datetime
  confirmed_by: human_operator
```

`confirmed=false`の場合、投稿案を生成してはならない。

## 10.2 客席・第三者の映り込み

以下のいずれかに該当する場合、手動確認を必須とする。

- 客席が明瞭に映っている
- 顔が識別できる第三者が映っている
- スタッフが主要被写体として映っている
- 他グループの演者が映っている
- 会場内掲示に個人情報が含まれる

自動顔検出は補助機能とし、最終判断には使用しない。

## 10.3 メンバー・運営への配慮

禁止表現は以下とする。

- 公式発表でない情報の断定
- メンバーの感情や意図の推測
- 人気順位を示唆する比較
- 他メンバーや他グループを下げる表現
- 運営方針への断定的批判
- 私生活の推測
- 公式アカウントと誤認される表現
- 過度に広告的な煽り文句

---

# 11. 投稿生成ルール

## 11.1 テンプレート選択

Hermesは以下の順序でテンプレートを選択する。

```text
Event State
  ↓
Content Category
  ↓
Target Stage
  ↓
Destination
  ↓
Tone
  ↓
Template
```

## 11.2 文体

標準文体は以下とする。

- 個人のファンとして自然
- 過剰に整いすぎない
- 宣伝文句を連続させない
- 絵文字は0〜2個
- 感嘆符は原則2個以下
- 強い断定を避ける
- 投稿ごとに人間が一文以上修正可能な構造にする
- 同一の書き出しを繰り返さない
- 「話題沸騰」「絶対」「必見」等の誇張表現を原則使わない

## 11.3 ハッシュタグ

標準上限は3個とする。

優先順位は以下。

1. `#CUBΣLIC`
2. 公式に使用されている公演タグ
3. メンバー名または企画固有タグ

無関係なトレンドタグを使用しない。

## 11.4 外部リンク

動画投稿とリンク誘導は原則分離する。

以下のいずれかをテンプレートごとに設定する。

```yaml
link_strategy:
  mode: none | reply | separate_post | body
```

初期値は以下とする。

| カテゴリ | リンク戦略 |
|---|---|
| `live_digest` | `reply` |
| `member_focus` | `none`または`reply` |
| `setlist_flash` | `body` |
| `event_notice` | `body` |
| `beginner_guide` | `body` |
| `youtube_notice` | `body` |
| `community_question` | `none` |

アルゴリズムに関する未検証の仮説を絶対ルールにしない。

リンク有無、投稿時刻、文面構造は実測データにより見直す。

---

# 12. 速報性・投稿寿命

## 12.1 Freshness Score

Hermesは投稿候補に0〜100の速報性スコアを付与する。

例:

| 経過時間 | 基準点 |
|---|---:|
| 終演後30分以内 | 100 |
| 2時間以内 | 85 |
| 6時間以内 | 70 |
| 12時間以内 | 55 |
| 24時間以内 | 40 |
| 48時間以内 | 20 |
| 48時間超 | 10 |

最終スコアは以下を加味する。

- セトリ確定済み
- 動画あり
- 他では得にくい情報
- 次回公演との関連
- メンバー固有の見せ場
- 権利確認に要した時間

速報性が高くても権利ゲートを省略してはならない。

---

# 13. コンテンツ品質評価

## 13.1 Content Score

投稿候補に以下の評価を持たせる。

| 軸 | 範囲 |
|---|---:|
| 正確性 | 0〜20 |
| 速報性 | 0〜15 |
| 希少性 | 0〜15 |
| 新規向け理解度 | 0〜15 |
| メンバー・楽曲魅力 | 0〜15 |
| 導線明確性 | 0〜10 |
| 会話・共有可能性 | 0〜10 |

合計100点。

## 13.2 投稿基準

```text
80点以上: 承認候補
65〜79点: 要改善
64点以下: 投稿しない
```

スコアだけで自動公開してはならない。

---

# 14. UTM・ファネル設計

## 14.1 誘導先

投稿カテゴリごとに標準誘導先を設定する。

| カテゴリ | 標準誘導先 |
|---|---|
| `member_focus` | メンバー紹介ページ |
| `song_focus` | 楽曲ページまたはYouTube |
| `setlist_flash` | セットリストページ |
| `event_notice` | ライブ予定ページ |
| `beginner_guide` | 初心者ガイド |
| `live_digest` | YouTubeフル尺または関連ライブページ |
| `playlist_notice` | Spotifyプレイリスト |
| `weekly_summary` | 週次まとめページ |

## 14.2 UTM規約

```text
utm_source=x
utm_medium=social
utm_campaign=<event_id or campaign_id>
utm_content=<category>_<template_id>_<variant>
```

例:

```text
https://cubelic-fan.com/events/evt_20260721
?utm_source=x
&utm_medium=social
&utm_campaign=evt_20260721_example
&utm_content=event_notice_v1_a
```

URLは`url-builder`サービスで生成する。

手入力は禁止する。

---

# 15. A/Bテスト

## 15.1 Phase 2から有効化

A/Bテストは同一投稿の同時配信ではなく、一定期間の交互比較とする。

対象例:

- 冒頭が感想型か情報型か
- 動画先行か説明先行か
- リンクを本文に置くか別投稿に置くか
- 公演7日前か3日前か
- メンバー名を冒頭に置くか後半に置くか

## 15.2 制約

- 同一内容を短期間に重複投稿しない
- 1実験につき変更要素は1個
- 最低4週間または各バリアント10件を目安
- 統計的有意差を過度に主張しない
- 少数データでは方向性の参考に限定する

---

# 16. 承認フロー

## 16.1 ステータス

```text
ingested
  ↓
validated
  ↓
draft_generated
  ↓
pending_review
  ├─ rejected
  ├─ needs_revision
  └─ approved
        ↓
scheduled
        ↓
published
        ↓
measured
        ↓
archived
```

## 16.2 権限

| 操作 | Hermes | X Harness | 人間 |
|---|---:|---:|---:|
| 素材読込 | 可 | 不可 | 可 |
| 投稿案生成 | 可 | 不可 | 可 |
| 下書き保存 | 可 | 可 | 可 |
| 本文修正 | 提案のみ | 不可 | 可 |
| 予約確定 | Phase 1不可 | 実行 | 可 |
| 即時投稿 | 不可 | 実行 | 可 |
| 投稿削除 | 不可 | 実行 | 可 |
| DM送信 | 不可 | 無効 | 原則不可 |
| 自動返信 | 不可 | 無効 | 不可 |

---

# 17. 投稿しない判断

## 17.1 Reject Reason

投稿しなかった理由を構造化して保存する。

```text
rights_unconfirmed
filming_scope_unknown
third_party_visible
member_unknown
event_unknown
song_unknown
duplicate_content
duplicate_media
quality_low
audio_sync_issue
incorrect_metadata
link_invalid
expired_content
tone_inappropriate
official_confusion_risk
manual_rejection
other
```

## 17.2 改善利用

週次レポートでは以下を集計する。

- 投稿拒否理由の件数
- 最も多い入力不足
- 何をメタデータ化すれば改善できるか
- Resolve書き出し時点で追加すべき情報
- GAS入力時点で追加すべき情報

---

# 18. 分析仕様

## 18.1 取得タイミング

投稿後の指標を以下で取得する。

- 2時間
- 24時間
- 72時間
- 7日

## 18.2 保存指標

可能な範囲で以下を保存する。

```text
impressions
video_views
video_completion_rate
likes
reposts
quotes
replies
profile_visits
follows_attributed
link_clicks
qualified_visits
youtube_clicks
spotify_clicks
ticket_clicks
```

取得できない指標は`null`とし、推測値で埋めない。

## 18.3 分析単位

以下で集計可能にする。

- カテゴリ
- メンバー
- 楽曲
- 公演
- 対象ファンステージ
- 投稿時刻
- 曜日
- リンク戦略
- テンプレート
- A/Bバリアント
- 感情タグ
- 動画尺
- 投稿までの経過時間

## 18.4 Hermesの分析制約

Hermesは次を行ってよい。

- 傾向の整理
- 改善候補の提案
- 未計測項目の指摘
- 次回テスト案の作成

Hermesは次を自動変更してはならない。

- KPI
- 投稿頻度
- 文体ポリシー
- 権利ルール
- 承認ルール
- 投稿カテゴリ比率
- アカウント方針

---

# 19. コミュニティ設計

## 19.1 投稿種別

投稿を以下に分ける。

```text
broadcast
conversation
reference
conversion
```

### `broadcast`

ライブ映像・速報などを届ける。

### `conversation`

返信・引用を自然に促す。

例:

- 好きな曲
- 初めて見たときの印象
- 次に見たいライブ映像
- セトリで嬉しかった曲

### `reference`

後から参照される情報。

例:

- 初心者ガイド
- セットリスト
- メンバー紹介

### `conversion`

予定、チケット、YouTubeなどへ誘導する。

会話投稿は機械的な質問を連発しない。

Hermesは返信を自動生成・投稿しない。

---

# 20. 障害・事故対応

## 20.1 インシデント種別

```text
wrong_event
wrong_member
wrong_song
rights_violation
privacy_issue
broken_link
duplicate_post
official_confusion
inappropriate_text
system_malfunction
unauthorized_publish
account_access_issue
```

## 20.2 緊急停止

以下を実装する。

```text
POST /admin/emergency-stop
```

実行後は以下を停止する。

- Hermesからの新規下書き登録
- 予約投稿実行
- X Harnessの投稿処理
- メトリクス取得以外の書き込み

環境変数でも停止できること。

```text
GLOBAL_PUBLISHING_DISABLED=true
```

## 20.3 削除フロー

1. 人間が投稿内容を確認
2. 必要に応じて投稿を削除
3. インシデント記録を作成
4. 関係者への連絡要否を判断
5. 訂正投稿または謝罪投稿を人間が作成
6. 再発防止ルールを更新
7. Codexでテストを追加

## 20.4 訂正文テンプレート

訂正文は自動投稿しない。

以下の要素を持つ下書きのみ作成可能とする。

```text
誤りの内容
正しい内容
訂正日時
影響範囲
必要な謝意
```

---

# 21. セキュリティ

## 21.1 シークレット

以下をGitへ保存しない。

- X API credentials
- X Harness secret
- Hermes access token
- Cloudflare token
- Google API credentials
- Spotify credentials
- Analytics credentials

`.env.example`にはキー名だけを記載する。

## 21.2 最小権限

Hermesには以下のみ付与する。

- 読み取り対象ディレクトリ
- 下書き登録API
- メトリクス取得API
- 要確認キュー作成API

X投稿削除、即時投稿、DM送信の権限は付与しない。

## 21.3 監査ログ

すべての状態変更について以下を保存する。

```json
{
  "audit_id": "",
  "actor": "human|hermes|system|codex",
  "action": "",
  "entity_type": "",
  "entity_id": "",
  "before": {},
  "after": {},
  "timestamp": "",
  "correlation_id": ""
}
```

監査ログは通常の管理画面から削除できないようにする。

---

# 22. Hermes Skills

## 22.1 `ingest-setlist`

入力:

- イベントID
- セットリストJSON
- 公演情報

処理:

- 曲名マスター照合
- 表記揺れ解決
- 未一致曲の要確認化
- LP更新状態確認
- 投稿候補生成

## 22.2 `inspect-media`

入力:

- 動画ファイル
- イベントメタデータ

処理:

- ファイル存在確認
- ハッシュ生成
- 尺・解像度確認
- 音声確認
- 重複確認
- 権利フィールド確認
- 手動映り込み確認の要求

## 22.3 `generate-post`

入力:

- Content Item
- Strategy Config
- Template
- Destination

出力:

- 3案以内の投稿文
- 推奨案
- 使用テンプレート
- 品質スコア
- 速報性スコア
- リスク
- 人間が確認すべき点

## 22.4 `collect-metrics`

入力:

- 公開済み投稿ID

処理:

- 指定タイミングの指標取得
- データ保存
- 欠損記録
- 異常値検出

## 22.5 `weekly-review`

出力:

- KPI進捗
- コンテンツ比率
- 有効だった投稿
- 効果が低かった投稿
- 拒否理由
- 権利確認の未完了件数
- 来週の候補
- A/Bテスト結果
- 方針変更の提案

方針は自動変更しない。

---

# 23. API要件

## 23.1 Planner API

```text
POST   /events
GET    /events
GET    /events/:id
PATCH  /events/:id

POST   /content
GET    /content
GET    /content/:id
PATCH  /content/:id

POST   /drafts/generate
GET    /drafts
GET    /drafts/:id
PATCH  /drafts/:id
POST   /drafts/:id/approve
POST   /drafts/:id/reject

POST   /media/validate
POST   /rights/validate

POST   /metrics/collect
GET    /metrics/summary

POST   /admin/emergency-stop
POST   /admin/emergency-resume
```

## 23.2 X Harness Adapter

X Harness OSS本体をアプリケーション層から直接呼ばない。

必ずAdapterを介する。

```typescript
interface XPublishingAdapter {
  createDraft(input: DraftInput): Promise<DraftResult>;
  schedulePost(input: ScheduleInput): Promise<ScheduleResult>;
  publishPost(input: PublishInput): Promise<PublishResult>;
  deletePost(input: DeleteInput): Promise<DeleteResult>;
  getMetrics(postId: string): Promise<PostMetrics>;
}
```

Phase 1では以下を強制する。

```typescript
publishPost(): never;
deletePost(): HumanOnlyOperation;
```

---

# 24. テスト要件

## 24.1 Unit Test

最低限以下をテストする。

- UTM生成
- 投稿文字数
- ハッシュタグ上限
- 禁止語
- 重複判定
- 権利ゲート
- イベント状態遷移
- 品質スコア
- 速報性スコア
- Reject Reason
- 承認状態遷移

## 24.2 Contract Test

以下の契約を固定する。

- GASセットリストJSON
- LPイベントJSON
- ResolveメタデータJSON
- Hermes出力
- X Harness Adapter
- Analyticsイベント

## 24.3 E2E Test

以下を自動テストする。

### E2E-01 セトリ速報

```text
セットリストJSON投入
↓
曲名照合
↓
Content Item生成
↓
投稿案生成
↓
承認
↓
X Harness下書き作成
```

実際のX投稿はモックする。

### E2E-02 権利未確認

```text
動画投入
↓
filming_policy.confirmed=false
↓
投稿案生成を停止
↓
rights_unconfirmedを記録
```

### E2E-03 重複動画

```text
同一sha256の動画を再投入
↓
duplicate_media
↓
投稿不可
```

### E2E-04 緊急停止

```text
GLOBAL_PUBLISHING_DISABLED=true
↓
予約・投稿操作が拒否される
```

---

# 25. 非機能要件

## 25.1 可用性

- 失敗時にデータを失わない
- Hermes再起動後に処理を再開できる
- 同一処理の再実行で二重投稿しない
- 投稿系処理には冪等性キーを持たせる

## 25.2 冪等性キー

```text
account_id
+ content_id
+ template_version
+ media_hash
```

から生成する。

## 25.3 ロギング

ログには以下を含める。

- correlation_id
- event_id
- content_id
- draft_id
- actor
- outcome
- error_code

本文、APIトークン、個人情報を不要に出力しない。

## 25.4 タイムゾーン

すべての保存時刻はISO 8601とする。

表示とスケジュールの標準タイムゾーンは以下。

```text
Asia/Tokyo
```

---

# 26. 段階導入

## Phase 1: 安全な下書き生成

実装範囲:

- X Harness OSS導入
- Adapter実装
- Strategy Config
- Event / Content / Draftモデル
- GASセットリスト取込
- UTM生成
- 投稿案生成
- 承認UI
- 下書き登録
- 監査ログ
- 緊急停止
- 権利ゲート
- 重複防止

自動予約・自動投稿は行わない。

### Phase 1完了条件

- セットリストJSONから投稿案を生成できる
- ライブ動画から投稿案を生成できる
- 権利未確認素材が停止される
- 人間が本文を修正できる
- 承認済みだけがX Harnessへ送られる
- 実X投稿なしでE2Eが通る
- 本番認証情報がGitに含まれない

---

## Phase 2: Hermesによる継続運用

実装範囲:

- Hermes Bridge
- Cron
- Resolve出力確認
- 投稿候補キュー
- 24h/72h/7日分析
- 週次レポート
- A/Bテスト
- コンテンツ比率監視
- Reject Reason集計

### Phase 2完了条件

- Hermes再起動後にタスク復旧できる
- 同一素材の二重登録がない
- 週次レポートが生成される
- 投稿方針は自動変更されない
- 実行権限が最小化されている

---

## Phase 3: 限定自動予約

自動予約を許可する候補:

- ライブ予定
- LP更新通知
- YouTube公開通知
- 事前承認済みテンプレート
- 権利を伴わない定型情報

ライブ映像、メンバー関連本文、感想投稿は引き続き人間承認とする。

### Phase 3完了条件

- 自動予約可能カテゴリがAllowlist管理される
- 1日上限と間隔制限が適用される
- 緊急停止が即時反映される
- 予約内容が事前確認できる
- 投稿事故時の削除手順が検証済み

---

# 27. 初期設定値

```yaml
account:
  id: tubelic_cube
  official_account: false
  timezone: Asia/Tokyo

publishing:
  max_posts_per_day: 2
  max_posts_per_week: 10
  minimum_interval_minutes: 240
  publish_now_enabled: false
  auto_schedule_enabled: false
  auto_dm_enabled: false
  auto_reply_enabled: false
  auto_like_enabled: false
  auto_follow_enabled: false

content:
  max_hashtags: 3
  max_generated_variants: 3
  duplicate_similarity_threshold: 0.82
  minimum_quality_score: 80

approval:
  live_video: human_required
  member_content: human_required
  opinion_content: human_required
  setlist_flash: human_required
  event_notice: human_required
  evergreen_update: human_required

rights:
  filming_confirmation_required: true
  evidence_required: true
  third_party_manual_review_required: true
```

---

# 28. Codex実装指示

Codexは以下の順序で実装すること。

## Task 1: 調査

1. X Harness OSSの現行リポジトリを確認する
2. 利用可能なMCP/API/SDKを特定する
3. Hermes Agentの現行Skill、Cron、Gateway仕様を確認する
4. 既存GASセットリストJSONの形式を確認する
5. cubelic-fan.comのイベント・セットリスト構造を確認する
6. 不明点を`docs/discovery.md`へ記録する

## Task 2: ADR作成

以下のADRを作成する。

```text
ADR-001 X Harnessを直接改変するかAdapterで包むか
ADR-002 データストアの選択
ADR-003 Hermesとの通信方式
ADR-004 承認UIの方式
ADR-005 Cloudflare配置範囲
ADR-006 ローカルResolve素材へのアクセス方式
```

## Task 3: スキーマ

JSON SchemaまたはZodで以下を定義する。

- Event
- Media Asset
- Content Item
- Draft Post
- Rights Evidence
- Metrics
- Incident
- Audit Log

## Task 4: Phase 1実装

実投稿機能を無効にした状態でPhase 1を完成させる。

## Task 5: レビュー

Codex自身で以下を実施する。

- 仕様適合レビュー
- 権限レビュー
- セキュリティレビュー
- エラー処理レビュー
- 冪等性レビュー
- X規約リスクレビュー
- テスト不足レビュー

OpenAIが説明するエージェント向け開発でも、境界条件を中央で厳密に定義し、その範囲内で自律性を与える方法が推奨されている。本実装でも、Hermesの自由度より先に権限境界・検証・再現性を実装すること。

---

# 29. 完成条件

本システムは以下をすべて満たした場合にPhase 1完成とする。

- [ ] セットリスト速報案を生成できる
- [ ] 動画投稿案を生成できる
- [ ] 投稿対象ステージが付与される
- [ ] 投稿カテゴリが付与される
- [ ] UTM URLが自動生成される
- [ ] 権利証跡が保存される
- [ ] 権利未確認時に停止する
- [ ] 客席映り込み確認を要求できる
- [ ] 重複素材を検出できる
- [ ] 3案以内の本文候補を生成できる
- [ ] 人間が本文を編集できる
- [ ] 人間承認なしで投稿できない
- [ ] X Harnessへの操作がAdapter経由である
- [ ] 監査ログが残る
- [ ] 緊急停止が機能する
- [ ] APIキーがリポジトリに存在しない
- [ ] Unit Testが通る
- [ ] Contract Testが通る
- [ ] E2E Testが通る
- [ ] READMEにセットアップ手順がある
- [ ] 運用手順書がある
- [ ] インシデント対応手順書がある

---

# 30. 対象外

初期版では以下を対象外とする。

- 自動DMマーケティング
- フォロー・リポスト条件キャンペーン
- LINEへの自動誘導
- 自動リプライ
- 自動フォロー
- 自動いいね
- 他者投稿への自動引用
- 他者動画の取得
- TikTok自動投稿
- Instagram自動投稿
- YouTube自動アップロード
- 顔認識によるメンバー自動判定
- AIによる撮影可否の推測
- 来場者の個人識別
- 自動的な戦略変更
- 完全無人運用

---

# 31. 将来拡張

将来的には以下を追加できる。

- Instagram Reels連携
- YouTube Shorts連携
- TikTok連携
- 複数アカウント管理
- DJイベント用アカウント
- メンバー別コンテンツポートフォリオ
- セットリスト傾向可視化
- LP内の行動分析
- チケットクリック計測
- 投稿文のブランド一貫性評価
- Resolve自動切り抜きシステムとの完全接続
- Content Planner UI
- 編集カレンダー
- モバイル承認UI

ただし、各SNSへの自動投稿機能は、それぞれの規約とAPI条件を個別に確認してから追加する。

---

# 32. 最終設計判断

本システムの責務は以下のように固定する。

```text
Strategy / Planner
    何を、誰に、何の目的で届けるかを定義する

Hermes Agent
    定義済みの戦略に従って素材を整理し、投稿案を作る

Human Operator
    文面、権利、温度感を確認し、承認する

X Harness OSS
    承認済みの操作だけをXへ反映する

Analytics
    結果を記録し、改善材料を提示する

Codex
    システムを構築・検証・修正し、安全境界を維持する
```

この責務分離を崩してはならない。

最終的な目標は投稿数を増やすことではない。

```text
良質な一次情報
  +
ファンらしい人間味
  +
初参加への導線
  +
安全な運用
```

を同時に成立させ、CUBΣLICを初めて知った人がライブへ参加しやすくなる状態を作ることである。

実装時には、まずこの仕様を`SPEC.md`、Codex向けの作業ルールを`AGENTS.md`へ分離し、Phase 1だけを最初のマイルストーンにするのが適切です。
