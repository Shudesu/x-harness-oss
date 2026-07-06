---
chapter: 6
title: 運用＆コスト管理
tier: paid
status: draft
---

# 第6章 運用＆コスト管理

> 【🔒 tier: 有料】X API の従量課金を「読みきる」運用、verify_only ベストプラクティス、そして実際に発生したコスト事故事例を扱います。

## 章の目的
- X API 残高を毎日確認するルーティンを構築できる
- verify_only 設計をコードレベル・運用レベルの両方で徹底できる
- 過去の事故事例を踏まえ、自分のキャンペーンで同じ罠を踏まないチェックリストを持てる

## 想定読者
- すでに X Harness を本番稼働させている運用責任者
- コスト破綻リスクを定量的に管理したいマーケター・経営者
- Xステップを使ってきたが「裏で何が動いているか分からない」状態に不安な人

## 前提
- 第5章までの E2E が稼働しており、実トラフィックが流れていること
- 第2章で月次コスト上限の初期設定を済ませていること

---

## 6.1 運用の原則 ― 「コストが見える」状態を日常化する

X Harness を本番に置いた瞬間、運用者の最大の関心事は「機能が動くか」ではなく **「今いくら使ってるか」** に変わる。X API は従量課金で、一発の設計ミスで簡単に二桁ドル飛ぶ。だから運用設計は最初から **コストの可視化を中心** に組む。

X Harness が SaaS（Xステップ等）と決定的に違うのは、**API の叩かれ方が完全に手の内にある** という点だ。SaaS は月額固定だが裏で何回 API を叩いているかブラックボックス。X Harness は OSS なのでソースを開けば全部追える。これは諸刃の剣で、設計を間違えれば自分の責任で破裂する。

運用の原則は3つに絞る。

1. **verify_only を中心に据える** — Cron ポーリングを極限まで減らし、ユーザー操作起点でしか X API を叩かない
2. **D1 を一次キャッシュとして必ず挟む** — Worker はステートレス。インメモリキャッシュは効かないと思え
3. **毎朝 X Developer Portal を開く** — 自動アラートを過信せず、人間の目視を最終防衛線にする

この3つは、後述する 2026-04-11 の $132 事故の **再発防止策がそのまま運用ルール化したもの** だ。

---

## 6.2 verify_only の正しい運用 ― D1 優先チェックと API hit の最小化

### 6.2.1 verify_only という思想

エンゲージメントゲートには複数の `action_type` があるが、**コスト面で圧倒的に推奨されるのは `verify_only`** だ。

| action_type | 動作 | X API コスト |
|---|---|---|
| `mention_post` / `dm` | Cron ポーリングし条件を満たす全ユーザーに自動配信 | リプライ数 × ポーリング頻度 |
| `verify_only` | Cron 走らない。ユーザーが LIFF から verify を叩いた時 **だけ** 判定 | ほぼ $0 〜 数セント |

`verify_only` はユーザーの能動的な参加タイミングに合わせて判定する。誰も参加しない日のコストはゼロ。Cron は「参加者0でも10円かかる」モデルなので、長期運用するキャンペーンほど差がつく。

実装上も `processOneGate` の冒頭でガードしている（`apps/worker/src/services/engagement-gate.ts`）。

```ts
if (gate.action_type === 'verify_only') return;
```

Cron が回っても即スキップ。コスト破裂の起点になりがちな「全フォロワー走査」「全リプライ走査」も `verify_only` の世界には存在しない。

### 6.2.2 D1 優先チェックの三段ガード

verify_only でも、うっかり全件取得すれば破裂する（事故の本筋がそれだ）。なので verify エンドポイントは **「X API を叩く前に必ず D1 を見る」** という三段構成で組まれている。

```
User → /api/engagement-gates/:id/verify?username=xxx
   │
   ├─ ① replier_cache（gate ごとの確認済みユーザープール）
   │     → ヒット & eligible なら $0 で即返す
   │
   ├─ ② follower_id_cache（X アカウントのフォロワー ID 全体）
   │     → ヒットなら getFollowers を呼ばずに「フォロー済み」確定
   │
   └─ ③ それでも未確定なら X API を1ユーザー単位で叩く
         → 結果を ① ② にバルク UPSERT し次回以降を $0 化
```

キモは **「キャッシュは消さない、累積する」**。`replier_cache` は UPSERT で書き TTL で消えない。`follower_id_cache` は全件取得時にバルク投入し、以後の全 verify が D1 ルックアップだけで済むようにしている。バルク UPSERT は `c.executionCtx.waitUntil()` でレスポンス返却後に走らせるため応答時間は犠牲にならない。**「初回1人だけ重い、2人目以降は全員 $0」** という曲線になる。

### 6.2.3 新規キャンペーン投入前のチェック

- ゲート設定で `action_type = 'verify_only'` になっているか
- フォームの webhook URL が `/api/engagement-gates/:id/verify?username={x_username}` か（`/repliers` 全件取得を webhook に置かない）
- LIFF で blur イベントごとに verify を叩いていないか。**送信ボタン押下時のみ** に統一する

最後の項目は **コードレビュー必須**。入力欄外をタップしただけで verify が走る UI は、`replier_cache` がまだ温まっていない時期に X API を秒で枯らす。

---

## 6.3 日次・週次の監視ルーチン

### 毎朝の3点チェック（所要1分）

運用責任者は毎朝 X Developer Portal を開く。これは自動化しない。アラートが鳴ってからでは遅い（事故時はアラート設定すらなかった）。

1. **Read 数（前日 / 当月累計）** — `Usage` タブ。前日 Read が10件以下なら正常、100件超なら何かが裏で叩いている
2. **残高（Balance）** — 想定外の速度で減っていないか
3. **支出上限（Spending Cap）** — 設定済みか、上限に近づいていないか

### ダッシュボードの API Usage パネル

X Harness ダッシュボード（Phase 2）の使用量パネルは Worker 内部の `incrementApiUsage` を D1 に蓄積したもの。`verify_get_followers` の発火回数を毎週見る。**同じユーザーで一日に何十回も立っているのは設計が壊れているサイン**。

### 週次の見直しと配信レート

毎週金曜の運用ミーティングで以下を確認する。

- **配信成功率** — `deliveries` で `status = 'delivered'` の比率。`failed` の急増はスパム判定の疑い
- **API 残高 vs 想定** — 当月累計が見積に収まっているか
- **Cap への接近度** — 月の半分で 70% 超なら一度ペースを落とす

X はスパム判定が **LINE よりはるかに厳しい**。短時間に同テンプレで連投すると `failed` が急増する。`stealth.ts` の `addJitter(30_000, 180_000)` は短縮しない ―― 凍結1回の機会損失は API 課金の比じゃない。

---

## 6.4 事故事例: 2026-04-11 $132 の教訓

ここからは 2026-04-11 に **このリポで実際に起きた** インシデントを書く。経緯から修正まで一気通貫で扱う。

### 経緯

請求サイクル（4/7〜5/7）の途中、何気なく `Usage` タブを開いたら **当月課金が $132.91**。$140 をチャージして残高 -$16.79、つまり **チャージしたほぼ全額がたった4日で消えていた**。

その時点での想定運用コストは「リプライトリガー verify_only で月 $3〜5」。実測値は **想定の30倍以上**。

最初に疑ったのは「誰かがゲートを増やしたのでは」。違った。ゲートは1個、`verify_only`、Cron は無効。仕様上コストが立つのは LIFF から verify が叩かれた時だけ ―― にもかかわらず Read 数は前日だけで数千件オーダーだった。

### 原因

`verify` の `follow` トリガー分岐を読み直して犯人が見つかった（修正前）。

```ts
// 修正前: フォローチェックが毎リクエスト全フォロワー取得
if (gate.trigger_type === 'follow') {
  const followerIds = await xClient.getFollowers(accountXUserId); // ★
  // ↑ 内部で paginationToken を最大10ページ＝最悪 10,000 件取得
  return c.json({ eligible: followerIds.has(xUser.id) });
}
```

そして LIFF 側は X ユーザー名入力欄の **blur イベント（入力欄外をタップ）ごとに verify を叩く** UI。ユーザーが入力中に画面の余白を1回タップするたびに、Worker が起動し、`getFollowers` をページネーション最大まで回し、**数千件単位で Read を消費** する。

被害規模を後追い計算すると：

- フォロワー約 4,304 人 × 100件×10ページ ＝ 約1,000 Read（上限到達時）
- 参加ユーザー 468 人 × blur 平均2〜3回 ＝ verify 約 1,000〜1,400 回
- 合計 Read = 約 15,000+ ＝ **$75〜130 相当**

「Worker メモリにキャッシュされてるから2回目以降は安い」という暗黙の前提があった。**しかし Cloudflare Workers はステートレス**。リクエストごとに別ワーカーインスタンスに当たり、JS のモジュールスコープ変数は当てにならない。**Worker のインメモリキャッシュは存在しないと思え** ―― これが最大の教訓だ。

### 修正（2026-04-11 デプロイ済み）

その日のうちに以下4点を入れた。

1. **`follower_id_cache` テーブルを D1 に追加** — verify 前に必ず先見て、既知のフォロワーは X API を叩かずに返す
2. **初回ミス時のみ `getFollowers` を呼び結果を D1 にバルク UPSERT** — 以後そのアカウントの全 verify が $0
3. **`replier_cache` の eligible=false 再チェックに2分ガード** — 短時間連打を物理的に止める
4. **LIFF `form.ts` の verify を送信時のみに変更** — blur 起点の発火を撤去

修正後の課金マトリクスはこうなった。

| ステップ | X API 呼ぶか | コスト |
|---|---|---|
| `replier_cache` ヒット & eligible | 呼ばない | $0 |
| `replier_cache` ヒット & not eligible（条件再チェック） | 1〜2 件 | $0.01〜0.10 |
| `replier_cache` ミス & `follower_id_cache` ヒット | 呼ばない | $0 |
| 両ミス（初回1人だけ） | `getUserByUsername` + `getFollowers` 1回 | $0.05〜0.30 |
| 2分ガード期間内の再試行 | 呼ばない | $0 |

実測は **1日 $0.1〜1 ペース**。事故前想定の月 $3〜5 レンジに収まった。

### 二度と起こさないための運用ルール

事故からテンプレ化したのが以下。これが本章の結論。

1. **Worker のインメモリキャッシュに依存しない** — D1 を必ずキャッシュレイヤに挟む。`Map`・モジュールスコープ変数・`globalThis` への代入はすべて「今のリクエスト1回で消える」と思え
2. **X API 呼び出しには必ずレートガードを入れる** — 最低2分間隔、または D1 の `cached_at` で弾く
3. **`getFollowers` の全ページ取得を毎リクエストで走らせない** — 全件取得は「初回1回だけ、結果を D1 に書く」のセットでしか
4. **支出上限（Spending Cap）を必ず設定する** — 事故時は未設定。月次想定の3倍程度（例：$50/サイクル）を上限に
5. **毎朝 X Developer Portal を開く** — 自動アラートを過信せず目視を最終防衛線に
6. **LIFF の blur イベントで verify を叩かない** — 送信ボタン押下時のみに集約する

---

## 6.5 トラブルシュート Quick Reference

### 「Read が前日だけ突然増えた」

疑う順序：(1) 新規ゲートが増えていないか `engagement_gates` を `created_at DESC` で確認、(2) `action_type` が `verify_only` 以外になっていないか、(3) 新規キャンペーンの LIFF が blur 起点で verify を叩いていないか DevTools の Network で再現、(4) `replier_cache` / `follower_id_cache` が空になっていないか。

```sql
-- 直近の API hit 内訳（request_count は日別集計値）
SELECT endpoint, SUM(request_count) AS hits, MAX(created_at) AS last_hit
FROM api_usage_logs WHERE date >= date('now', '-1 day')
GROUP BY endpoint ORDER BY hits DESC;
```

### 「verify が常に false / 条件を満たしていません」

- `replier_cache` に古い `eligible = 0` が残り2分ガードで再チェック抑制中 → 待つか該当 gate_id の cache を削除
- `follower_id_cache` 未生成 → 初回 verify で UPSERT が走り2人目以降は解消
- ゲートが `is_active = 0` または `expires_at` 経過 → `engagement_gates` を確認

### 「Worker が 503」

`verify` 末尾の catch で `X API エラー` を返す経路。X 側のレート制限・障害、もしくは残高切れ。Portal の Status と残高を最初に確認。`npx wrangler tail x-harness-worker --format pretty` でログ尾行。

### 「配信されたはずなのに X 側に投稿/DM がない」

`deliveries` で `status` を見る。`failed` ならスパム判定の疑い（直近の同テンプレ連投本数と jitter を確認）。`pending` のまま停滞は Rate Limit Error で中断した可能性、catch が発火していなければ手動で `failed` に書き換えて再キュー。

### コスト見積もりの当て

| シナリオ | 月額レンジ |
|---|---|
| `verify_only` + リプライトリガー（参加 100人/月） | **$0〜2** |
| `verify_only` + フォロートリガー（参加 500人/月） | **$1〜5** |
| `mention_post` Cron + リプライトリガー（毎時） | $3〜10 |
| `mention_post` Cron + バズ発生時 | $20〜45 |
| レガシー全件走査（非推奨） | $86+ |

**「だいたい $5/月でやれる」が X Harness の設計目標値**。これを大きく超えたら設計が壊れているサインとして扱う。

---

## まとめ

X Harness の運用は「コストが見える状態を日常化する」に尽きる。verify_only を中心に据え、D1 を必ず挟み、毎朝 Portal を開く ―― この3つを習慣にすれば、$132 事故の再現は構造的に起きない。

X API は使い方を間違えれば破裂するが、**設計を理解していれば月 $5 で運用できる**。それがブラックボックスの SaaS では絶対に手に入らない、X Harness の最大の価値だ。

---

## 次の章

本章で本編は終わりです。さらに深い設計テンプレートとケーススタディは **統合プレイブック ¥98,000 買い切り** に収録されています（[README](./README.md) 参照）。
