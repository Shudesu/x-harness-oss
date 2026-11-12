// Build metadata shared by the web build (next.config.ts) and the worker
// deploy (deploy-worker.mjs): release version from the root package.json,
// short git commit, and the build timestamp.
// CommonJS on purpose: Next compiles next.config.ts to CJS, and Node < 20.19
// cannot require() an ES module.
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const REPO_ROOT = join(__dirname, "..", "..");

function git(args) {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function getBuildInfo() {
  const { version } = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  let commit = process.env.BUILD_SHA || git(["rev-parse", "--short=7", "HEAD"]) || "unknown";
  // Mark builds made from uncommitted (incl. untracked, non-ignored) source so
  // they are never mistaken for the tagged release.
  if (!process.env.BUILD_SHA && commit !== "unknown" && git(["status", "--porcelain"])) {
    commit += "-dirty";
  }
  const builtAt = process.env.BUILD_DATE || new Date().toISOString();
  return { version, commit, builtAt };
}

module.exports = { REPO_ROOT, getBuildInfo };
