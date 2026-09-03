import { execFileSync } from "node:child_process";
import { repoRoot } from "./paths.mjs";

export function gitCapture() {
  const run = (args) => {
    try {
      return execFileSync("git", args, {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
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
