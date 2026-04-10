import * as p from "@clack/prompts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { wrangler } from "../lib/wrangler.js";
import { ensurePnpm, runPnpm, type PnpmRunner } from "../lib/pnpm.js";

interface DeployAdminOptions {
  repoDir: string;
  workerUrl: string;
  projectName: string;
}

interface DeployAdminResult {
  adminUrl: string;
}

export async function deployAdmin(
  options: DeployAdminOptions,
): Promise<DeployAdminResult> {
  const s = p.spinner();
  const webDir = join(options.repoDir, "apps/web");

  // Write .env.production with the Worker URL
  s.start("Admin UI ビルド準備中...");
  const envContent = `NEXT_PUBLIC_API_URL=${options.workerUrl}\n`;
  writeFileSync(join(webDir, ".env.production"), envContent);

  // Ensure pnpm is available before building (Admin UI uses pnpm workspace).
  // We do this here rather than in checkDeps so resume flows that skip the
  // admin step don't require pnpm.
  let pnpmRunner: PnpmRunner;
  try {
    pnpmRunner = await ensurePnpm();
  } catch (error: any) {
    s.stop("Admin UI ビルド失敗");
    throw error;
  }

  // Build Next.js (static export -> out/)
  s.message("Admin UI ビルド中...");
  try {
    await runPnpm(pnpmRunner, ["run", "build"], { cwd: webDir });
  } catch (error: any) {
    s.stop("Admin UI ビルド失敗");
    throw new Error(`Admin UI のビルドに失敗しました: ${error.message}`);
  }
  s.stop("Admin UI ビルド完了");

  // Deploy to CF Pages
  s.start("Admin UI デプロイ中...");
  try {
    // Create Pages project first (ignore error if already exists)
    try {
      await wrangler([
        "pages",
        "project",
        "create",
        options.projectName,
        "--production-branch",
        "main",
      ]);
    } catch {
      // Already exists, that's fine
    }

    const output = await wrangler(
      [
        "pages",
        "deploy",
        "out",
        "--project-name",
        options.projectName,
        "--commit-dirty=true",
      ],
      { cwd: webDir },
    );

    // Parse the actual subdomain from wrangler output or project list
    let adminUrl = `https://${options.projectName}.pages.dev`;
    try {
      const projectList = await wrangler(["pages", "project", "list"]);
      const subdomainMatch = projectList.match(
        new RegExp(`${options.projectName}\\s+│\\s+(\\S+\\.pages\\.dev)`),
      );
      if (subdomainMatch) {
        adminUrl = `https://${subdomainMatch[1]}`;
      }
    } catch {
      // Fall back to project name
    }

    s.stop("Admin UI デプロイ完了");
    return { adminUrl };
  } catch (error: any) {
    s.stop("Admin UI デプロイ失敗");
    throw new Error(`Admin UI のデプロイに失敗しました: ${error.message}`);
  }
}
