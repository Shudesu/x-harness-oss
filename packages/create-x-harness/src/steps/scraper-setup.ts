import * as p from "@clack/prompts";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface ScraperTokens {
  authToken: string;
  ct0: string;
}

// Prompt for optional free-scraping setup (twitter-cli cookie auth).
// Returns null if the user skips.
export async function promptScraperSetup(): Promise<ScraperTokens | null> {
  p.log.step("═══ オプション: 無料収集(twitter-cli)セットアップ ═══");
  p.log.message(
    [
      "X の読み取り(検索・投稿収集・メトリクス)を X API 課金なしで行えます。",
      "仕組み: twitter-cli(Cookie 認証)を Claude Code / Codex の MCP 経由で実行します。",
      "",
      "■ 必要なもの",
      "  1. twitter-cli:  uv tool install twitter-cli  (または pipx install twitter-cli)",
      "  2. X の Cookie 2 つ(auth_token, ct0)",
      "",
      "■ Cookie の取得方法",
      "  ブラウザで x.com にログイン → 開発者ツール → Application → Cookies → x.com",
      "  → auth_token と ct0 の値をコピー",
      "",
      "⚠ 凍結リスクの注意: 収集専用のサブアカウントの Cookie を推奨します。",
      "  投稿(write)は X API 経由なので、メインアカウントの Cookie は不要です。",
      "  Cookie はローカルの設定ファイルにのみ保存され、サーバーには送信されません。",
    ].join("\n"),
  );

  const enable = await p.confirm({
    message: "無料収集をセットアップしますか?(後から .mcp.json に手動追加も可能)",
    initialValue: true,
  });
  if (p.isCancel(enable) || !enable) {
    p.log.info("無料収集: スキップ(README の手順で後から有効化できます)");
    return null;
  }

  const notEmpty = (value: string | undefined) =>
    value && value.trim() ? undefined : "値が空です。Cookie の値を貼り付けてください";

  const authToken = await p.password({ message: "auth_token Cookie の値", validate: notEmpty });
  if (p.isCancel(authToken)) {
    p.log.info("無料収集: キャンセルされたためスキップします(README の手順で後から有効化できます)");
    return null;
  }
  const ct0 = await p.password({ message: "ct0 Cookie の値", validate: notEmpty });
  if (p.isCancel(ct0)) {
    p.log.info("無料収集: キャンセルされたためスキップします(README の手順で後から有効化できます)");
    return null;
  }

  return { authToken: (authToken as string).trim(), ct0: (ct0 as string).trim() };
}

// Copy bundled skills into the user's project for Claude Code and Codex.
// force:false preserves user-edited skill files on rerun; failures must not
// abort setup (remote deployment already succeeded at this point).
export function installSkills(repoDir: string): void {
  const skillsSrc = join(repoDir, "skills");
  if (!existsSync(skillsSrc)) {
    p.log.warn(
      "スキルが見つかりませんでした(リポジトリに skills/ がありません)。`git -C ~/.x-harness pull` 後に再実行するか、手動で skills/ を .claude/skills/ にコピーしてください。",
    );
    return;
  }
  try {
    const cwd = process.cwd();
    for (const dest of [join(cwd, ".claude", "skills"), join(cwd, ".codex", "skills")]) {
      mkdirSync(dest, { recursive: true });
      cpSync(skillsSrc, dest, { recursive: true, force: false });
    }
    p.log.success(
      "スキルをインストールしました: .claude/skills/ と .codex/skills/ (x-growth-discover / x-growth-article / x-growth-video)",
    );
  } catch (error: any) {
    p.log.warn(
      `スキルのコピーに失敗しました(${error.message})。手動で skills/ を .claude/skills/ と .codex/skills/ にコピーしてください。`,
    );
  }
}

// Print the Codex CLI MCP registration snippet.
export function printCodexSnippet(options: {
  workerUrl: string;
  apiKey: string;
  scraperTokens: ScraperTokens | null;
}): void {
  const envLines = [
    `X_HARNESS_API_URL = "${options.workerUrl}"`,
    `X_HARNESS_API_KEY = "${options.apiKey}"`,
    ...(options.scraperTokens
      ? [
          `TWITTER_AUTH_TOKEN = "${options.scraperTokens.authToken}"`,
          `TWITTER_CT0 = "${options.scraperTokens.ct0}"`,
        ]
      : []),
  ];
  p.note(
    [
      "Codex CLI からも使う場合は ~/.codex/config.toml に追加してください:",
      "",
      "[mcp_servers.x-harness]",
      'command = "npx"',
      'args = ["-y", "@x-harness/mcp@latest"]',
      "",
      "[mcp_servers.x-harness.env]",
      ...envLines,
    ].join("\n"),
    "Codex CLI 設定(任意)",
  );
}
