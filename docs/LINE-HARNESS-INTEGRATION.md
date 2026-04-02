# X Harness × LINE Harness 連携ガイド

## 概要

Xのエンゲージメントキャンペーン（いいね+RT+フォロー+リプライ）の条件判定をX Harnessが行い、LINE Harnessのフォーム経由で特典を配布するクロスプラットフォーム連携。

## アーキテクチャ

```
Xポスト（キャンペーン告知 + トラッキングリンク）
  ↓ ユーザーがリンクをタップ
LINE /auth/line?ref=xxx&form=FORM_ID
  ↓ OAuth認証 + 友だち追加
LINE トーク画面にフォームリンクがpushで届く
  ↓ ユーザーがフォームを開く
LIFFフォーム（XアカウントID入力）
  ↓ ブラウザからverify API呼び出し
X Harness verify API（条件判定）
  ↓ eligible: true / false
LIFFフォーム画面に結果表示（pushメッセージ不要）
```

## コスト

| 項目 | コスト |
|------|--------|
| X API | verify呼び出し時のみ（Cronなし） |
| LINE push | フォームリンク1通/人 |
| インフラ | CF無料枠 $0 |

## セットアップ手順

### 1. X Harness でEngagement Gate作成

```
POST /api/engagement-gates
{
  "xAccountId": "your-x-account-id",
  "postId": "キャンペーン対象のポストID",
  "triggerType": "reply",
  "actionType": "verify_only",
  "template": "verify_only - no message sent",
  "requireLike": true,
  "requireRepost": true,
  "requireFollow": true,
  "replyKeyword": "参加"
}
```

レスポンスの `id`（gate_id）をメモ。

### 2. LINE Harness でフォーム作成

```
POST /api/forms
{
  "name": "X特典受け取りフォーム",
  "description": "Xキャンペーンの特典を受け取るフォーム",
  "fields": [
    {
      "name": "x_username",
      "label": "XアカウントID（@なし）",
      "type": "text",
      "required": true
    }
  ],
  "onSubmitWebhookUrl": "https://{YOUR_X_HARNESS_URL}/api/engagement-gates/{GATE_ID}/verify?username={x_username}",
  "onSubmitWebhookFailMessage": "条件を満たしていません。フォロー・いいね・リポスト・「参加」リプライの4条件を確認してください。",
  "onSubmitMessageType": "text",
  "onSubmitMessageContent": "🎉 おめでとうございます！全条件クリアしました！\n\n特典はこちら→ https://example.com/gift"
}
```

レスポンスの `id`（form_id）をメモ。

### 3. Xポストにトラッキングリンクを設置

```
🎁 特典プレゼント企画 🎁

①フォロー ②いいね ③リポスト ④「参加」とリプライ

で全員に特典プレゼント！

特典受け取りはこちら→ https://{YOUR_LINE_HARNESS_URL}/auth/line?ref=campaign1&form={FORM_ID}
```

### 4. 複数企画の運用

企画ごとにゲートとフォームを作成し、トラッキングリンクのform_idを変える。

```
企画1: /auth/line?ref=campaign1&form=FORM_ID_1
企画2: /auth/line?ref=campaign2&form=FORM_ID_2
```

- 企画ごとにエンゲージメント条件を個別設定可能
- 同じユーザーが複数企画に参加可能
- 管理画面のフォーム回答で企画別の参加者を確認可能

## 仕組みの詳細

### verify API

```
GET /api/engagement-gates/{gate_id}/verify?username={x_username}
```

- **認証不要**（gate_idがUUIDで推測不可能）
- リアルタイムでX APIを叩いて条件判定
- Cronポーリングなし（verify_onlyモード）

レスポンス例（条件クリア）:
```json
{
  "success": true,
  "data": {
    "eligible": true,
    "conditions": {
      "reply": true,
      "like": true,
      "repost": true,
      "follow": true
    }
  }
}
```

レスポンス例（条件未達）:
```json
{
  "success": true,
  "data": {
    "eligible": false,
    "conditions": {
      "reply": true,
      "like": false,
      "repost": true,
      "follow": false
    },
    "message": "条件を満たしていません"
  }
}
```

### フォームWebhook（ブラウザ側）

フォーム定義の `onSubmitWebhookUrl` に設定されたURLを、**LIFFのブラウザ（JavaScript）から直接呼び出す**。

- `{x_username}` はフォーム入力値で自動置換
- Workerサーバー側ではなくブラウザ側で実行（CF Workers同一アカウントfetch制限の回避）
- verify API応答の `eligible` / `data.eligible` / `success` を判定

### /auth/line?form= パラメータ

トラッキングリンクに `form=FORM_ID` を含めると：

- **初回ユーザー**: OAuth認証 → 友だち追加 → フォームリンクをpush送信
- **既存友だち**: OAuth認証 → フォームリンクをpush送信
- フォームリンクはLINEメッセージとして届く（1通のpush消費）

## 注意事項

- verify APIはgate_idが秘密鍵の役割。gate_idを外部に漏らさない（フォームのwebhook URLに含まれるがフロントから見える）
- X APIの `searchRecentTweets` は直近7日間のツイートのみ検索可能。7日以上前のキャンペーンは判定できない
- `replyKeyword` を設定する場合、ユーザーにキーワードを明示する（ポスト文中に記載）
- 非アクティブ・期限切れのゲートは自動的にverify拒否される
