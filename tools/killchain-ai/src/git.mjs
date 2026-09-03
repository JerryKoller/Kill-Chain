import { execFileSync } from "node:child_process";
import { repoRoot } from "./paths.mjs";

export function gitRun(args, { allowFail = false, encoding = "utf8" } = {}) {
  try {
    const out = execFileSync("git", args, {
      cwd: repoRoot,
      encoding,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Do not String#trim() — porcelain lines can start with a space (` M path`).
    return String(out).replace(/[\r\n]+$/, "");
  } catch (err) {
    if (allowFail) {
      const out = err.stdout ? String(err.stdout).replace(/[\r\n]+$/, "") : "";
      return out;
    }
    throw err;
  }
}

export function gitCapture() {
  const run = (args) => {
    try {
      return gitRun(args);
    } catch {
      return null;
    }
  };
  return {
    commit: run(["rev-parse", "HEAD"]),
    short: run(["rev-parse", "--short", "HEAD"]),
    branch: run(["rev-parse", "--abbrev-ref", "HEAD"]),
    dirty: Boolean(run(["status", "--porcelain"])),
  };
}
