import * as p from "@clack/prompts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

interface McpConfigOptions {
  workerUrl: string;
  apiKey: string;
}

// Walk up from `start` looking for a `.git` directory. Returns the repo root
// or null if no git repo is found.
function findGitRoot(start: string): string | null {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Returns true if the root `.gitignore` excludes the `.mcp.json` we are
// about to write at `cwd`. Honors gitignore anchoring semantics:
//   `.mcp.json`  → matches at any depth
//   `/.mcp.json` → matches only at the repo root
function gitignoresMcpJson(gitRoot: string, cwd: string): boolean {
  const gitignorePath = join(gitRoot, ".gitignore");
  if (!existsSync(gitignorePath)) return false;
  try {
    const lines = readFileSync(gitignorePath, "utf-8")
      .split("\n")
      .map((l) => l.trim());
    const cwdIsRoot = resolve(cwd) === resolve(gitRoot);
    return lines.some((l) => {
      if (l === ".mcp.json") return true;
      if (l === "/.mcp.json") return cwdIsRoot;
      return false;
    });
  } catch {
    return false;
  }
}

export function generateMcpConfig(options: McpConfigOptions): void {
  const cwd = process.cwd();
  const mcpJsonPath = join(cwd, ".mcp.json");

  const newServerConfig = {
    command: "npx",
    args: ["-y", "@x-harness/mcp@latest"],
    env: {
      X_HARNESS_API_URL: options.workerUrl,
      X_HARNESS_API_KEY: options.apiKey,
    },
  };

  let mcpConfig: Record<string, any> = {};

  if (existsSync(mcpJsonPath)) {
    try {
      mcpConfig = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
    } catch {
      // Existing file is malformed JSON. Don't overwrite — that would
      // silently delete other MCP servers the user already configured.
      p.log.warn(
        ".mcp.json が壊れているため自動追加をスキップしました。手動で MCP 設定を追加してください。",
      );
      return;
    }
  }

  if (!mcpConfig.mcpServers) {
    mcpConfig.mcpServers = {};
  }

  // Determine target server name. Reruns from the same directory should be
  // idempotent: if an existing entry already points at the same Worker URL,
  // update it in place (whatever its name). Otherwise prefer the canonical
  // `x-harness` name, falling back to a suffixed name only when there's an
  // existing entry pointing at a *different* worker.
  let serverName = "x-harness";
  const existingMatch = Object.entries(mcpConfig.mcpServers).find(
    ([, cfg]: [string, any]) =>
      cfg && cfg.env && cfg.env.X_HARNESS_API_URL === options.workerUrl,
  );
  if (existingMatch) {
    serverName = existingMatch[0];
  } else if (mcpConfig.mcpServers["x-harness"]) {
    const suffix = options.apiKey.slice(0, 8);
    serverName = `x-harness-${suffix}`;
    p.log.info(
      `既存の x-harness 設定があるため、${serverName} として追加します`,
    );
  }
  mcpConfig.mcpServers[serverName] = newServerConfig;

  // Wrap the actual write in try/catch so a local FS failure (read-only
  // checkout, perm error, full disk) does NOT abort an otherwise successful
  // remote deployment at the very end of setup.
  try {
    writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + "\n");
    p.log.success(`.mcp.json に MCP 設定を追加しました（${serverName}）`);
  } catch (error: any) {
    p.log.warn(
      `.mcp.json の書き込みに失敗しました（${error.message}）。手動で MCP 設定を追加してください。`,
    );
    return;
  }

  // Secret-leak guard: .mcp.json now contains the API key. If we're inside a
  // git repo and the file isn't gitignored, warn loudly so the user doesn't
  // accidentally commit it.
  const gitRoot = findGitRoot(cwd);
  if (gitRoot && !gitignoresMcpJson(gitRoot, cwd)) {
    p.log.warn(
      [
        "⚠️  .mcp.json には API Key が平文で含まれています。",
        "   この cwd は git 管理下ですが .gitignore に .mcp.json がありません。",
        "   コミットしないよう .gitignore に追記してください:",
        "",
        "     echo .mcp.json >> .gitignore",
      ].join("\n"),
    );
  }
}
