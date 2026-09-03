import { execFileSync } from "node:child_process";
import { repoRoot } from "./paths.mjs";

const GIT_MAX_BUFFER = 64 * 1024 * 1024;

export function gitRun(args, {
  allowFail = false,
  encoding = "utf8",
  stripTrailingNl = true,
  maxBuffer = GIT_MAX_BUFFER,
} = {}) {
  try {
    const out = execFileSync("git", args, {
      cwd: repoRoot,
      encoding,
      maxBuffer,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (encoding === "buffer") return out;
    const s = String(out);
    // Do not String#trim() — porcelain lines can start with a space (` M path`).
    // Do not strip trailing newlines from diffs: that corrupts the final hunk.
    return stripTrailingNl ? s.replace(/[\r\n]+$/, "") : s;
  } catch (err) {
    if (allowFail) {
      if (encoding === "buffer") return err.stdout || Buffer.alloc(0);
      const out = err.stdout ? String(err.stdout) : "";
      return stripTrailingNl ? out.replace(/[\r\n]+$/, "") : out;
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
