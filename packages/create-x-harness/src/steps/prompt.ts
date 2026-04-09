import * as p from "@clack/prompts";

export interface XCredentials {
  xAccessToken: string;
  xConsumerKey: string;
  xConsumerSecret: string;
  xAccessTokenSecret: string;
  xUserId: string;
  xUsername: string;
}

export async function promptXCredentials(): Promise<XCredentials> {
  // ═══ Step 2: X (Twitter) API 認証情報 ═══
  p.log.step("═══ Step 2. X (Twitter) API 認証情報 ═══");

  p.log.message(
    [
      "X 自動投稿・自動返信のために、X (旧 Twitter) Developer のキーが必要です。",
      "",
      "※ X 公式の Pay-Per-Use プラン（基本料 $0 + リクエスト単位課金）が必要です。",
      "  X Harness 自体は料金を請求しません。",
    ].join("\n"),
  );

  // ─── Step 2-1: Developer アカウント申請 + 英語のユースケース文 ───
  p.log.message(
    [
      "■ Step 2-1. X Developer アカウント申請",
      "",
      "https://developer.x.com にアクセス",
      "→ コンソールへ",
      "→ X アカウントでログイン",
      "→ ユースケース説明を **英語で 250 文字以上** 入力",
      "  （後述のサンプルをコピペで OK）",
      "→ 利用規約に同意して送信",
      "",
      "※ 英語の説明文は X のレビューを通すために必須です。日本語不可。",
      "  以下のサンプルをそのままコピペして使えます。",
    ].join("\n"),
  );

  p.note(
    [
      "I will use the X (Twitter) API to automate my own X account for",
      "personal marketing purposes. Specifically, I will use the API to:",
      "(1) post tweets and threads on a schedule, (2) reply to mentions",
      "of my own account, (3) read public engagement metrics (likes,",
      "retweets, replies) on my own posts to measure marketing",
      "effectiveness, and (4) verify whether specific users have liked,",
      "retweeted, or followed my account so that I can deliver promised",
      "rewards to them. I will not display tweets or aggregate Twitter",
      "data outside of Twitter, and I will not share data with any",
      "government entity. All actions are limited to my own account.",
    ].join("\n"),
    "コピペ用：英語ユースケース説明文",
  );

  await p.text({
    message: "Developer アカウント申請が完了したら Enter を押してください",
    defaultValue: "done",
  });

  // ─── Step 2-1.5: クレジット購入 ───
  p.log.message(
    [
      "■ X Developer Console でクレジットを購入",
      "",
      "※ 基本は 5 ドルの課金のみで十分です。",
      "※ X Harness が課金することはありませんのでご安心ください。",
    ].join("\n"),
  );
  await p.text({
    message: "クレジット購入手続きが完了したら Enter を押してください",
    defaultValue: "done",
  });

  // ─── Step 2-1.5: プロジェクト + アプリ作成 ───
  p.log.message(
    [
      "■ Step 2-1.5. プロジェクトとアプリ作成",
      "",
      "Developer Console にログインした状態で:",
      "→ アプリ → 新規作成",
      "→ プロジェクト名・用途を入力",
      "→ アプリ名（任意の名前）、Environment（Development）を入力",
      "→ 作成完了",
    ].join("\n"),
  );
  await p.text({
    message: "プロジェクト・アプリ作成が完了したら Enter を押してください",
    defaultValue: "done",
  });

  // ─── Step 2-2: コンシューマーキー / Secret Key ───
  p.log.message(
    [
      "■ Step 2-2. コンシューマーキー / Secret Key 取得",
      "",
      "そのままの画面でコンシューマーキー / Secret Key を収録します。",
      "",
      "※ この画面を閉じると二度と表示されません。両方コピーしてから次へ進んでください",
    ].join("\n"),
  );

  const xConsumerKey = await p.text({
    message: "コンシューマーキー",
    placeholder: "表示されたコンシューマーキーを貼り付け",
    validate(value) {
      if (!value || value.trim().length < 10) {
        return "コンシューマーキーを入力してください";
      }
    },
  });
  if (p.isCancel(xConsumerKey)) {
    p.cancel("セットアップをキャンセルしました");
    process.exit(0);
  }

  const xConsumerSecret = await p.text({
    message: "Secret Key",
    placeholder: "表示された Secret Key を貼り付け",
    validate(value) {
      if (!value || value.trim().length < 10) {
        return "Secret Key を入力してください";
      }
    },
  });
  if (p.isCancel(xConsumerSecret)) {
    p.cancel("セットアップをキャンセルしました");
    process.exit(0);
  }

  // ─── Step 2-2.5: ユーザ認証設定（アクセストークン生成より前に必須） ───
  // X はアクセストークン生成時に権限スコープを固定するため、必ずトークン
  // 生成前にアプリ権限を Read/Write/DM に切り替えておく必要がある。
  // コールバック URI はデプロイ後に実 URL で設定するため、ここでは権限のみ。
  p.log.message(
    [
      "■ ユーザ認証設定（重要：アクセストークン生成より前に必ず実施）",
      "",
      "→ ユーザ認証設定 → セットアップ",
      "→ アプリの権限",
      "→ 「読み書きおよびダイレクトメッセージ」をチェック",
      "→ 変更を保存する",
      "",
      "※ ここを先に設定しないと、後で生成するアクセストークンが",
      "  Read のみとなり投稿・返信・DM が動作しません。",
      "",
      "※ コールバック URI やウェブサイト URL は後のステップで案内します。",
      "  ここではアプリ権限の変更だけでOKです。",
    ].join("\n"),
  );
  await p.text({
    message: "アプリ権限の設定が完了したら Enter を押してください",
    defaultValue: "done",
  });

  // ─── Step 2-3: アクセストークン / アクセストークンシークレット ───
  p.log.message(
    [
      "■ Step 2-3. アクセストークン / アクセストークンシークレット 取得",
      "",
      "同じ画面で",
      "→ OAuth 1.0 キー セクション",
      "→ アクセストークン → 「生成する」",
      "→ 表示された **「アクセストークン」** と **「アクセスシークレット」** をコピー",
    ].join("\n"),
  );

  const xAccessToken = await p.text({
    message: "アクセストークン",
    placeholder: "上の手順でコピーしたアクセストークン",
    validate(value) {
      if (!value || value.trim().length < 10) {
        return "アクセストークンを入力してください";
      }
    },
  });
  if (p.isCancel(xAccessToken)) {
    p.cancel("セットアップをキャンセルしました");
    process.exit(0);
  }

  const xAccessTokenSecret = await p.text({
    message: "アクセスシークレット",
    placeholder: "上の手順でコピーしたアクセスシークレット",
    validate(value) {
      if (!value || value.trim().length < 10) {
        return "アクセスシークレットを入力してください";
      }
    },
  });
  if (p.isCancel(xAccessTokenSecret)) {
    p.cancel("セットアップをキャンセルしました");
    process.exit(0);
  }

  // ─── Step 2-4: X User ID ───
  p.log.message(
    [
      "■ Step 2-4. X User ID 取得",
      "",
      "https://develop.tools/x-idcheck/ にアクセス",
      "→ X のユーザー名（@ から始まる ID）を入力",
      "→ 「取得実行」をクリック",
      "→ 表示されたユーザ ID の数字をコピー",
    ].join("\n"),
  );

  const xUserId = await p.text({
    message: "X User ID（数字）",
    placeholder: "develop.tools/x-idcheck/ で取得した数字の ID",
    validate(value) {
      if (!value || !/^\d+$/.test(value.trim())) {
        return "X User ID は数字で入力してください";
      }
    },
  });
  if (p.isCancel(xUserId)) {
    p.cancel("セットアップをキャンセルしました");
    process.exit(0);
  }

  // ─── Step 2-5: ユーザー名 ───
  p.log.message(
    [
      "■ Step 2-5. X ユーザー名",
      "",
      "X プロフィールの @ から始まる ID（@ は付けずに入力）",
    ].join("\n"),
  );

  const xUsername = await p.text({
    message: "X ユーザー名（@ なし）",
    placeholder: "例: elonmusk",
    validate(value) {
      if (!value || value.trim().length === 0) {
        return "ユーザー名を入力してください";
      }
      if (value.startsWith("@")) {
        return "@ なしで入力してください";
      }
    },
  });
  if (p.isCancel(xUsername)) {
    p.cancel("セットアップをキャンセルしました");
    process.exit(0);
  }

  return {
    xAccessToken: (xAccessToken as string).trim(),
    xConsumerKey: (xConsumerKey as string).trim(),
    xConsumerSecret: (xConsumerSecret as string).trim(),
    xAccessTokenSecret: (xAccessTokenSecret as string).trim(),
    xUserId: (xUserId as string).trim(),
    xUsername: (xUsername as string).trim(),
  };
}
