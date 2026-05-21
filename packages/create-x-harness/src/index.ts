import { resolve, dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runSetup } from "./commands/setup.js";
import { ensureRepo } from "./steps/clone-repo.js";

const args = process.argv.slice(2);

const HELP_TEXT = `create-x-harness — set up X Harness with one command.

Usage:
  npx create-x-harness [command] [options]

Commands:
  setup    Run first-time setup (default). Clones the repo to ~/.x-harness
           if missing, then provisions Cloudflare + X credentials.

Options:
  --repo-dir <path>    Use an existing checkout of x-harness-oss instead of
                       cloning to ~/.x-harness.
  -h, --help           Show this help and exit.
  -v, -V, --version    Print the version and exit.

Examples:
  npx create-x-harness
  npx create-x-harness --repo-dir ./my-fork
`;

function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/index.js → ../package.json
    const pkg = JSON.parse(
      readFileSync(join(here, "..", "package.json"), "utf-8"),
    ) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

interface ParsedArgs {
  command: string;
  repoDir: string | null;
  showHelp: boolean;
  showVersion: boolean;
  unknownFlag: string | null;
}

function parseArgs(): ParsedArgs {
  let command = "setup";
  let repoDir: string | null = null;
  let showHelp = false;
  let showVersion = false;
  let unknownFlag: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--repo-dir" && args[i + 1]) {
      repoDir = resolve(args[i + 1]);
      i++;
    } else if (arg === "-h" || arg === "--help") {
      showHelp = true;
    } else if (arg === "-v" || arg === "-V" || arg === "--version") {
      showVersion = true;
    } else if (arg.startsWith("-")) {
      unknownFlag = arg;
    } else {
      command = arg;
    }
  }

  return { command, repoDir, showHelp, showVersion, unknownFlag };
}

async function main(): Promise<void> {
  const parsed = parseArgs();

  // Handle --help / --version BEFORE touching the network or filesystem.
  // Cloning ~/.x-harness or running wrangler auth on `--help` is a setup
  // side-effect users don't expect.
  if (parsed.showHelp) {
    process.stdout.write(HELP_TEXT);
    return;
  }
  if (parsed.showVersion) {
    console.log(readPackageVersion());
    return;
  }
  if (parsed.unknownFlag) {
    console.error(`Unknown option: ${parsed.unknownFlag}`);
    console.error("Run `npx create-x-harness --help` for usage.");
    process.exit(1);
  }

  if (parsed.command !== "setup") {
    console.error(`Unknown command: ${parsed.command}`);
    console.error("Run `npx create-x-harness --help` for usage.");
    process.exit(1);
  }

  // Ensure repo is available (clone if needed)
  const repoDir = await ensureRepo(parsed.repoDir);
  await runSetup(repoDir);
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
