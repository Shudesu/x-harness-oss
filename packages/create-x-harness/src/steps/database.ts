import * as p from "@clack/prompts";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wrangler, WranglerError } from "../lib/wrangler.js";

interface DatabaseResult {
  databaseId: string;
  databaseName: string;
}

export async function createDatabase(
  repoDir: string,
  databaseName: string,
): Promise<DatabaseResult> {
  const s = p.spinner();

  // Create D1 database
  s.start("D1 データベース作成中...");
  let databaseId: string;
  try {
    const output = await wrangler(["d1", "create", databaseName]);
    // Parse database_id from TOML or JSON format
    const tomlMatch = output.match(/database_id\s*=\s*"([^"]+)"/);
    const jsonMatch = output.match(/"database_id"\s*:\s*"([^"]+)"/);
    const uuidMatch = output.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    );
    const match = tomlMatch || jsonMatch || uuidMatch;
    if (!match) {
      throw new Error(`D1 ID をパースできません: ${output}`);
    }
    databaseId = match[1];
    s.stop("D1 データベース作成完了");
  } catch (error) {
    if (
      error instanceof WranglerError &&
      error.stderr.includes("already exists")
    ) {
      s.stop("D1 データベースは既に存在します");
      const listOutput = await wrangler(["d1", "list", "--json"]);
      const databases = JSON.parse(listOutput);
      const db = databases.find(
        (d: { name: string }) => d.name === databaseName,
      );
      if (!db) {
        throw new Error("既存の D1 データベースが見つかりません");
      }
      databaseId = db.uuid;
    } else {
      throw error;
    }
  }

  // Versioned fresh-install migrations. Legacy databases require the documented
  // schema audit and baseline adoption, never exception-driven blind retries.
  const directory=mkdtempSync(join(tmpdir(),'xh-db-'));
  const config=join(directory,'wrangler.json');
  writeFileSync(config,JSON.stringify({name:'x-harness-bootstrap',compatibility_date:'2026-10-26',d1_databases:[{binding:'DB',database_name:databaseName,database_id:databaseId,migrations_dir:join(repoDir,'packages/db/bootstrap')}]}));
  s.start('バージョン管理されたDBマイグレーションを適用中...');
  try { await wrangler(['d1','migrations','apply',databaseName,'--remote','--config',config]); }
  finally { rmSync(directory,{recursive:true,force:true}); }
  s.stop('DBマイグレーション完了');

  return { databaseId, databaseName };
}
