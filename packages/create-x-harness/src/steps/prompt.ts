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

  // ─── Step 2-1: プロジェクトとアプリ作成 ───
  p.log.message(
    [
      "■ Step 2-1. X Developer プロジェクトとアプリ作成",
      "",
      "https://developer.x.com にアクセス",
      "→ ログイン（X アカウント）",
      "→ Developer Portal",
      "→ Projects & Apps → New Project",
      "→ プロジェクト名・用途を入力",
      "→ アプリ名を入力（任意の名前）",
      "→ 作成完了",
    ].join("\n"),
  );
  await p.text({
    message: "プロジェクト・アプリ作成が完了したら Enter を押してください",
    defaultValue: "done",
  });

  // ─── Step 2-2: Consumer Key / Consumer Secret ───
  p.log.message(
    [
      "■ Step 2-2. Consumer Key / Consumer Secret 取得",
      "",
      "作成したアプリの管理画面",
      "→ 「Keys and tokens」タブ",
      "→ Consumer Keys セクション",
      "→ 「Regenerate」をクリック",
      "→ 表示された **API Key** と **API Key Secret** をコピー",
      "",
      "※ この画面を閉じると二度と表示されません。両方コピーしてから次へ進んでください",
    ].join("\n"),
  );

  const xConsumerKey = await p.text({
    message: "Consumer Key（API Key）",
    placeholder: "上の手順でコピーした API Key",
    validate(value) {
      if (!value || value.trim().length < 10) {
        return "Consumer Key を入力してください";
      }
    },
  });
  if (p.isCancel(xConsumerKey)) {
    p.cancel("セットアップをキャンセルしました");
    process.exit(0);
  }

  const xConsumerSecret = await p.text({
    message: "Consumer Secret（API Key Secret）",
    placeholder: "上の手順でコピーした API Key Secret",
    validate(value) {
      if (!value || value.trim().length < 10) {
        return "Consumer Secret を入力してください";
      }
    },
  });
  if (p.isCancel(xConsumerSecret)) {
    p.cancel("セットアップをキャンセルしました");
    process.exit(0);
  }

  // ─── Step 2-3: Access Token / Access Token Secret ───
  p.log.message(
    [
      "■ Step 2-3. Access Token / Access Token Secret 取得",
      "",
      "同じ「Keys and tokens」タブ",
      "→ Authentication Tokens セクション",
      "→ Access Token and Secret → 「Generate」",
      "→ 表示された **Access Token** と **Access Token Secret** をコピー",
      "",
      "※ アプリ権限が **Read and Write**（または Read, Write and Direct Messages）",
      "  になっていることを必ず確認してください。Read のみだと投稿できません。",
    ].join("\n"),
  );

  const xAccessToken = await p.text({
    message: "Access Token",
    placeholder: "上の手順でコピーした Access Token",
    validate(value) {
      if (!value || value.trim().length < 10) {
        return "Access Token を入力してください";
      }
    },
  });
  if (p.isCancel(xAccessToken)) {
    p.cancel("セットアップをキャンセルしました");
    process.exit(0);
  }

  const xAccessTokenSecret = await p.text({
    message: "Access Token Secret",
    placeholder: "上の手順でコピーした Access Token Secret",
    validate(value) {
      if (!value || value.trim().length < 10) {
        return "Access Token Secret を入力してください";
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
      "https://tweeterid.com にアクセス",
      "→ X のユーザー名（@ から始まる ID）を入力",
      "→ 「CONVERT」をクリック",
      "→ 表示された数字の ID をコピー",
    ].join("\n"),
  );

  const xUserId = await p.text({
    message: "X User ID（数字）",
    placeholder: "tweeterid.com で取得した数字の ID",
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
