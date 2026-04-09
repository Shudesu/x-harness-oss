import * as p from "@clack/prompts";
import pc from "picocolors";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { checkDeps } from "../steps/check-deps.js";
import { ensureAuth, getAccountId } from "../steps/auth.js";
import { promptXCredentials } from "../steps/prompt.js";
import { createDatabase } from "../steps/database.js";
import { deployWorker } from "../steps/deploy-worker.js";
import { deployAdmin } from "../steps/deploy-admin.js";
import { setSecrets } from "../steps/secrets.js";
import { generateMcpConfig } from "../steps/mcp-config.js";
import { generateApiKey } from "../lib/crypto.js";
import { wrangler, setAccountId } from "../lib/wrangler.js";
import type { SetupState } from "../lib/config.js";

function getStatePath(repoDir: string): string {
  return join(repoDir, ".x-harness-setup.json");
}

function loadState(repoDir: string): SetupState {
  const path = getStatePath(repoDir);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      // corrupt file, start fresh
    }
  }
  return { completedSteps: [] };
}

function saveState(repoDir: string, state: SetupState): void {
  writeFileSync(
    getStatePath(repoDir),
    JSON.stringify(state, null, 2) + "\n",
  );
}

function isDone(state: SetupState, step: string): boolean {
  return state.completedSteps.includes(step);
}

function markDone(state: SetupState, step: string): void {
  if (!state.completedSteps.includes(step)) {
    state.completedSteps.push(step);
  }
}

export async function runSetup(repoDir: string): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" X Harness セットアップ ")));

  p.log.message(
    [
      "X Harness は 3 Step で導入できます。",
      "",
      "  Step 1. Cloudflare アカウント設定",
      "  Step 2. X (Twitter) API 認証情報の取得",
      "  Step 3. プロジェクト名の入力",
      "",
      "残りの作業（D1 作成・Worker / Admin デプロイ等）は自動で行います。",
    ].join("\n"),
  );

  const state = loadState(repoDir);

  if (state.completedSteps.length > 0) {
    p.log.info(
      `前回の途中から再開します（完了済み: ${state.completedSteps.join(", ")}）`,
    );
  }

  // Pre-step: Check dependencies (Node, pnpm, git)
  await checkDeps();

  // ═══ Step 1: Cloudflare アカウント設定 ═══
  p.log.step("═══ Step 1. Cloudflare アカウント設定 ═══");
  p.log.message(
    [
      "Cloudflare の無料枠で Worker と D1 をホストします。",
      "アカウントがない場合は事前に作成してください:",
      "",
      "https://dash.cloudflare.com/sign-up",
      "→ メールアドレス・パスワードを登録",
      "→ メール認証を完了",
      "",
      "完了したら下のログイン画面に進みます（ブラウザが自動で開きます）。",
    ].join("\n"),
  );
  await ensureAuth();

  // Step 1.5: Pick Cloudflare account (silent if only one)
  if (!state.accountId) {
    const accountId = await getAccountId();
    state.accountId = accountId;
    saveState(repoDir, state);
    p.log.success(`Cloudflare アカウント: ${accountId}`);
  }
  // Pin all wrangler commands to this account
  setAccountId(state.accountId);

  // ═══ Step 2: X API 認証情報 ═══
  // (Header + sub-steps printed inside promptXCredentials)
  if (!isDone(state, "credentials")) {
    const credentials = await promptXCredentials();
    state.xAccessToken = credentials.xAccessToken;
    state.xConsumerKey = credentials.xConsumerKey;
    state.xConsumerSecret = credentials.xConsumerSecret;
    state.xAccessTokenSecret = credentials.xAccessTokenSecret;
    state.xUserId = credentials.xUserId;
    state.xUsername = credentials.xUsername;
    markDone(state, "credentials");
    saveState(repoDir, state);
  } else {
    p.log.success("X API 認証情報: 入力済み（スキップ）");
  }

  // ═══ Step 3: プロジェクト名 ═══
  if (!state.projectName) {
    p.log.step("═══ Step 3. プロジェクト名 ═══");
    p.log.message(
      [
        "Worker と D1 データベースの名前に使われます。",
        "英小文字・数字・ハイフンのみ使用できます（例: my-x-bot）。",
      ].join("\n"),
    );
    const projectName = await p.text({
      message: "プロジェクト名",
      placeholder: "x-harness",
      defaultValue: "x-harness",
      validate(value) {
        if (!value) return undefined; // use default
        if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) {
          return "英小文字・数字・ハイフンのみ使用できます（例: my-x-bot）";
        }
      },
    });
    if (p.isCancel(projectName)) {
      p.cancel("セットアップをキャンセルしました");
      process.exit(0);
    }
    state.projectName = (projectName as string).trim() || "x-harness";
    saveState(repoDir, state);
  } else {
    p.log.success(`プロジェクト名: ${state.projectName}`);
  }

  // Generate API key (silent)
  if (!state.apiKey) {
    state.apiKey = generateApiKey();
    saveState(repoDir, state);
  }

  // Step 6: Create D1 database + run migrations
  if (!isDone(state, "database")) {
    const { databaseId, databaseName } = await createDatabase(
      repoDir,
      state.projectName!,
    );
    state.dbId = databaseId;
    state.dbName = databaseName;
    markDone(state, "database");
    saveState(repoDir, state);
  } else {
    p.log.success(`D1 データベース: 作成済み（${state.dbId}）`);
  }

  // Step 7: Deploy Worker
  const workerName = state.projectName!;
  if (!isDone(state, "worker")) {
    const { workerUrl } = await deployWorker({
      repoDir,
      d1DatabaseId: state.dbId!,
      d1DatabaseName: state.dbName!,
      workerName,
      accountId: state.accountId!,
    });
    state.workerUrl = workerUrl;
    markDone(state, "worker");
    saveState(repoDir, state);
  } else {
    p.log.success(`Worker: デプロイ済み（${state.workerUrl}）`);
  }

  // Step 8: Set secrets
  if (!isDone(state, "secrets")) {
    await setSecrets({
      workerName,
      apiKey: state.apiKey!,
      xAccessToken: state.xAccessToken!,
      workerUrl: state.workerUrl!,
    });
    markDone(state, "secrets");
    saveState(repoDir, state);
  } else {
    p.log.success("シークレット: 設定済み");
  }

  // Step 9: Register X account in DB via API
  if (!isDone(state, "xAccount")) {
    const s = p.spinner();
    s.start("X アカウント登録中...");
    try {
      const res = await fetch(`${state.workerUrl}/api/x-accounts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${state.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          xUserId: state.xUserId,
          username: state.xUsername,
          accessToken: state.xAccessToken,
          accessTokenSecret: state.xAccessTokenSecret,
          consumerKey: state.xConsumerKey,
          consumerSecret: state.xConsumerSecret,
        }),
      });
      if (res.ok) {
        s.stop("X アカウント登録完了");
      } else {
        const data = (await res.json()) as Record<string, unknown>;
        s.stop(`X アカウント登録: ${data.error || "エラー"}`);
      }
    } catch {
      s.stop("X アカウント登録スキップ（Worker 起動待ち）");
    }
    markDone(state, "xAccount");
    saveState(repoDir, state);
  } else {
    p.log.success("X アカウント: 登録済み");
  }

  // Step 10: Deploy Admin UI
  //
  // CF Pages project names allow only [a-z0-9-] (no underscores) and must
  // not start/end with `-`. apiKey is `xh_<hex>` so slicing from index 0
  // would leak the `_` separator. Skip past the `xh_` prefix and take 8
  // hex chars; sanitize defensively in case apiKey format ever changes.
  const rawSuffix = state.apiKey!.replace(/^xh_/, "").slice(0, 8);
  const suffix = rawSuffix.replace(/[^a-z0-9]/gi, "").toLowerCase() || "ui";
  const adminProjectName = `${state.projectName}-admin-${suffix}`;
  if (!isDone(state, "admin")) {
    const { adminUrl } = await deployAdmin({
      repoDir,
      workerUrl: state.workerUrl!,
      projectName: adminProjectName,
    });
    state.adminUrl = adminUrl;
    markDone(state, "admin");
    saveState(repoDir, state);
  } else {
    p.log.success(`Admin UI: デプロイ済み（${state.adminUrl}）`);
  }

  // Step 11: Update X Developer callback URI (now that we have real URLs)
  p.log.message(
    [
      "■ X Developer Console でコールバック URI を設定してください",
      "",
      "→ ユーザ認証設定 → セットアップ → アプリ情報",
      "",
      "  コールバックURI / リダイレクトURL（必須）:",
      `    ${state.workerUrl}/auth/callback`,
      "",
      "  ウェブサイトURL（必須）:",
      `    ${state.adminUrl}`,
      "",
      "※ これを設定しないと X Harness との OAuth 連携が動作しません。",
    ].join("\n"),
  );
  await p.text({
    message: "コールバック URI の設定が完了したら Enter を押してください",
    defaultValue: "done",
  });

  // Step 12: Generate MCP config (always)
  generateMcpConfig({ workerUrl: state.workerUrl!, apiKey: state.apiKey! });

  // Step 13: Show completion screen
  p.note(
    [
      `${pc.bold("Worker URL:")}`,
      `   ${pc.cyan(state.workerUrl!)}`,
      "",
      `${pc.bold("Admin URL（こちらが管理画面になります）:")}`,
      `   ${pc.cyan(state.adminUrl!)}`,
      "",
      `${pc.bold("API Key:")}`,
      `   ${pc.dim(state.apiKey!)}`,
      `   → この値は再表示できません。安全な場所に保存してください`,
      "",
      `${pc.bold("X アカウント:")}`,
      `   @${state.xUsername} (${state.xUserId})`,
      "",
      `${pc.bold("管理画面のログインに API Key を使用します")}`,
    ].join("\n"),
    "X Harness セットアップ完了！",
  );

  // Save config for future use (separate from setup state)
  const configPath = join(repoDir, ".x-harness-config.json");
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        projectName: state.projectName,
        workerName,
        workerUrl: state.workerUrl,
        adminUrl: state.adminUrl,
        d1DatabaseName: state.dbName,
        d1DatabaseId: state.dbId,
      },
      null,
      2,
    ) + "\n",
  );

  // Clean up state file on success
  const statePath = getStatePath(repoDir);
  if (existsSync(statePath)) {
    unlinkSync(statePath);
  }

  p.outro(pc.green("X Harness を使い始めましょう！"));
}
