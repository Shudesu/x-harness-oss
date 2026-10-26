# LINE先行キャンペーン MVP

## 実装範囲

依頼資料のM1〜M7です。LINEで認証した参加者に「固定フレーズ＋5文字」を発行し、Xの投稿author_idから参加を照合します。参加者のX ID入力・候補者一覧選択はありません。既存のLINE友だちはLIFF上で合言葉を受け取り、結果だけをLINEに通知します。かんたん、標準、厳格、先着、在庫付き抽選、参加賞、個別コードを扱います。

新規作成は `POST /api/campaigns`（`mode: line_first`）に統一しています。MVPでは作成済みの告知投稿を登録します。標準・厳格は投稿の所有アカウントを確認します。Xへの告知投稿自動作成、完全な作成ウィザード/saga、厳格当選者のOAuth、紹介・ストリーク、Grokによる企画作成は依頼資料の後続工程です。入力した公開URLに勝手に投稿しません。

## 重要な設計補正

- 公開された合言葉はコピーできます。特典の送り先を発行先LINEに固定し、確定前は観測済みの早い投稿を優先しますが、OAuth相当の所有権証明とは表現しません。
- 先着は観測できた投稿の `created_at`、同時刻は数値ID順です。標準60秒・厳格180秒の待機を設け、ページングが終わるまで確定しません。遅れて見えた早い投稿が未確定なら並べ直します。確定後の結果は取り消しません。
- 正方向のsince_idと、10分の重複取得による遅延確認を分離しています。重複確認で正方向カーソルを進めず、ページング中の期間も固定します。それでも任意に遅れた検索結果まで完全に保証することはできません。
- コードは31文字の5桁で、曖昧文字を除外し、乱数の剰余バイアスも避けています。Androidの別投稿が別企画へ混ざる衝突を避けるため、コードはゲート単位より強い「同一DB内で一意」です。期限切れは行を残して再発行します。
- 在庫・個別コード・確定結果・通知outboxは同じD1バッチで確定します。書き込みに失敗した場合は在庫も巻き戻ります。ゲートのロック所有者もDBで照合します。
- フォローは対象IDへの確認とゲート内キャッシュで判定します。取得時点が不明な既存のフォロワーキャッシュを本人条件の根拠に流用しないため、資料の開始時スナップショットによる無料判定はMVPでは使いません。
- 返信の検出、フォロー確認、厳格での削除再確認にのみX APIを使います。新フローからXへ自動投稿・DMしません。
- 非参加者の投稿本文・プロフィールは保存しません（重複計測用IDは保持）。参加者の投稿を「自分の過去投稿」キャッシュへ混ぜず、AI下書きの学習入力にも流しません。
- 合言葉のない返信、展開されたユーザーデータ、重複確認にもAPI料金が発生し得ます。「参加者以外は必ず無料」「4タップ」「1分以内」を保証しません。実請求はプロバイダーで確認します。
- CPAは入力した投稿費・外部費用・特典原価が揃う場合だけ表示します。取得できない表示回数、LINE既読、費用を0や成功に置き換えません。

## 両サーバーの設定

1. 既存DBをバックアップし、実スキーマとmigration履歴を確認します。Xは`020-line-first-gates.sql`、LINEは対応する`*_x_line_first_gates.sql`を適用します。新規Xインストールにはbootstrap側の同じ020も含まれます。
2. LINE側は正しいMessaging APIアカウントにLogin channelとLIFFが設定されていることを確認します。複数アカウントではキャンペーンを特定のアカウントに固定します。
3. Xの共有LINE接続にAPIキーを保存し、設定画面「LINE先行キャンペーンの連携」で32文字以上のランダムな連携キーを登録します。X側では既存の`ENCRYPTION_KEY`で暗号化します。
4. LINE側に同じキーを`X_HARNESS_GATE_SECRET`として設定し、`X_HARNESS_URL`に信頼するX WorkerのHTTPS origin、`X_HARNESS_CONNECTION_ID`にX側接続IDを設定します。これは既存の単一X peer設定を継承する構成です。ブラウザの`xh`パラメータで接続先を選びません。
5. 厳格ティアを使うLINE側には `X_GATE_TURNSTILE_SITE_KEY` と `X_GATE_TURNSTILE_SECRET_KEY` が必要です。LIFF画面がWorkerと別hostnameなら `X_GATE_TURNSTILE_HOSTNAMES` に許可hostnameをカンマ区切りで設定します。Server-side verificationでaction・gate・hostnameも照合します。
6. X側の `GATE_CLAIMS` Durable Object bindingと`gate-claims-v1` migrationを設定します。OSSのwrangler設定とセットアップCLIに含めています。WFP等の別配信基盤は同じbindingの追加が必要です。bindingがなければcronによる確認となり、15秒間隔にはなりません。
7. Xのcronは1分です。未照合があるゲートだけDO alarmを動かし、最終発行から3分は15秒、30分までは60秒、その後300秒にします。手動確認は10秒以上の間隔です。結果イベントとLINE側計測イベントも再送されます。

連携キーは公開APIキーとしてブラウザへ渡さず、Worker secretとして管理します。キー更新は両側で揃えて行います。実送信を伴う確認は設定・宛先・承認を確認して別工程で行ってください。

## 通信契約

共通実装は両repoの`services/harness-gate-protocol.ts`。必須ヘッダーは `X-Harness-Connection-Id`, `X-Harness-Event`, `X-Harness-Delivery-Id`, `X-Harness-Timestamp`, `X-Harness-Signature` です。署名対象は次の改行区切りです。

```
xh.gate.v1
METHOD
/path?query
connectionId
eventName
deliveryId
epochMilliseconds
sha256(rawBody)
```

署名はHMAC-SHA256のhex、ヘッダー値は`sha256=<hex>`。許容時刻差は5分。再送時は同じDelivery ID・同じbody、新しいtimestampを使います。同じDelivery IDで異なるbodyは409です。新規コード発行は `(gate,LINE friend)` に対しても冪等です。

| 方向 | エンドポイント | 用途 |
|---|---|---|
| LINE→X | POST `/api/integrations/line-harness/claims` | 発行。署名されたLINE側だけがfriend IDを指定 |
| LINE→X | POST `/api/integrations/line-harness/claims/check` | 照合・実状態・再試行時間 |
| LINE→X | POST `/api/integrations/line-harness/events` | 実測したLINE追加・反応 |
| X→LINE | POST `/api/integrations/x-harness/campaigns` | 管理者認証＋HMAC。タグ・リンクの原子的準備 |
| X→LINE | POST `/api/integrations/x-harness/campaigns/:id/cancel` | 準備失敗時の無効化。履歴は削除しない |
| X→LINE | POST `/api/integrations/x-harness/events` | reply_matched / verified / reward_unlocked |
| X→LINE | GET `/api/integrations/x-harness/engagement?gateId=` | 参加後7日以内の2回以上の受信メッセージ/操作。既読とは別 |
| 参加者→LINE | POST `/api/liff/x-gates/:gateId/join`・`check` | ID/access tokenのaudience・subject・friendshipを検証 |

participant状態とは別に `rejectReason`（新しすぎるアカウント等）を返す場合があります。コードは消費せず再挑戦できます。XユーザーIDは投稿者からのみ採用し、参加者が送ったfriendId/usernameは採用しません。

## 送信と復旧

LINE送信は既存のHarness proxy handlerを使い、アカウントを固定してログ・リトライキーを保持します。公開OSSから特定運営者の外部サーバーへトークンを送る固定URLは埋め込みません。実操作で送信するときは、その環境の承認済みプロキシを使います。

結果outboxは1分・5分・30分・2時間・12時間で再送し、その後はdead状態になります。画面に要確認件数を出します。元のDelivery IDを保持し、LINE pushにも同じリトライキーを渡します。利用者が結果確認のreplyで受け取った場合は、その後の自動pushを省きます。replyの結果が不明なときは別pushへ自動切替せず、LIFF再表示／再操作で復旧します。プロバイダーの重複排除期間を越える再送は自動化しません。

通知に失敗しても確定した在庫を戻したり、別の人へコードを再割当てしません。未解決の配信・初回案内は`event_outbox`、LINE側の`x_gate_inbox`と`x_gate_reply_receipts`で確認します。

## 既存企画の移行

- X IDを自己申告する旧フォームは送信を止め、登録済みの新参加画面へ案内します。旧フォームに対応する新企画が未登録なら、新しい参加リンクへの差し替えが必要です。回答・履歴は削除しません。
- 公開トークン付きリンク、ユーザーから始めていない接触、既存の自動DMは停止します。返信起点・リンクなしの既存1回返信は残します。新規の旧式ゲート作成は停止しています。
- 旧ハズレ通知・ゼロ幅文字・長いcron sleep・tag-by-metadata呼び出しは使用しません。
- 新しい互換用トークンは128bitで14日。既存トークンは約束を黙って変えないため元の有効性を保持します。すでに公開されたトークンを自動で安全化することはできず、必要なら所有者が個別に失効を判断します。
- アーカイブは論理停止です。参加・配布・コード・外部IDの履歴を保持します。

### 旧migration 007の件数確認（読み取りのみ）

```
SELECT g.id, g.created_at, COUNT(d.id) AS delivery_count
FROM engagement_gates g
LEFT JOIN engagement_gate_deliveries d ON d.gate_id=g.id
GROUP BY g.id, g.created_at ORDER BY g.created_at;
SELECT COUNT(*) AS deliveries, MIN(created_at) AS oldest, MAX(created_at) AS newest
FROM engagement_gate_deliveries;
```

0件という結果だけでは消失を断定できません。適用前バックアップと比較してください。この作業では本番DBを読んだり復元したりしていません。

## 検証

- Xの通常テスト＋コード発行、コピー、同時刻、遅延した早い投稿、ページング、予算、在庫巻き戻しのテスト。
- LINEの既存Workerテスト＋別チャネル拒否、署名、再送、シナリオ重複防止、厳格チャレンジのテスト。
- 両repoを使うHTTP契約テスト。`LINE_GATE_REPO=/path/to/matching/line-checkout pnpm exec vitest run --config vitest.cross.config.ts`。
- `node scripts/smoke-gates.mjs` はローカルworkerdでPNG・署名・DO・D1確定を確認します。実X/LINE送信は行いません。
- OGPはSatori/resvgと同梱フォント・WASMを使います。固定ラベルを描き、値はDB由来です。依存互換性の修正と再現手順はassets/README.mdにあります。Cloudflareの本番CPU/DO利用枠を無料と仮定しません。
- 実機でのiOS/AndroidのX起動、実OAuth・Turnstile、実課金API、実LINE送信、既存本番の移行は未実施です。ブラウザ擬似操作は使っていません。
