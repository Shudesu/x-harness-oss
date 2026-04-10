import { tmpdir } from "node:os";
import { execa } from "execa";

const NEUTRAL_CWD = tmpdir();

export interface PnpmRunner {
  cmd: string;
  prefixArgs: string[];
}

async function hasPnpm(): Promise<boolean> {
  try {
    await execa("pnpm", ["--version"], { cwd: NEUTRAL_CWD });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure pnpm is available and return a runner config.
 * Tries: direct pnpm → corepack enable → npm install -g → npx fallback.
 */
export async function ensurePnpm(): Promise<PnpmRunner> {
  if (await hasPnpm()) return { cmd: "pnpm", prefixArgs: [] };

  // Try corepack first (built into Node 16.13+)
  try {
    await execa("corepack", ["enable", "pnpm"], { cwd: NEUTRAL_CWD });
    if (await hasPnpm()) return { cmd: "pnpm", prefixArgs: [] };
  } catch {
    // corepack may be missing or require admin on Windows
  }

  // Try global install via npm
  try {
    await execa("npm", ["install", "-g", "pnpm"], { cwd: NEUTRAL_CWD });
    if (await hasPnpm()) return { cmd: "pnpm", prefixArgs: [] };
  } catch {
    // fall through
  }

  // Final fallback: invoke pnpm via npx with COREPACK_INTEGRITY_KEYS=0
  try {
    await execa("npx", ["--yes", "pnpm@9.15.4", "--version"], {
      cwd: NEUTRAL_CWD,
      env: { ...process.env, COREPACK_INTEGRITY_KEYS: "0" },
    });
    return { cmd: "npx", prefixArgs: ["--yes", "pnpm@9.15.4"] };
  } catch {
    // fall through
  }

  throw new Error(
    "pnpm を起動できません。手動で `npm install -g pnpm` を実行してから再度お試しください。",
  );
}

/** Run a pnpm command using the resolved runner */
export async function runPnpm(
  runner: PnpmRunner,
  args: string[],
  options: { cwd: string },
): Promise<string> {
  const result = await execa(runner.cmd, [...runner.prefixArgs, ...args], {
    cwd: options.cwd,
    env: {
      ...process.env,
      COREPACK_INTEGRITY_KEYS: "0",
    },
  });
  return result.stdout;
}
