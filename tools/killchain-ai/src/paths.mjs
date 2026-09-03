import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const toolsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const repoRoot = resolve(toolsRoot, "..", "..");
export const dataDir = join(toolsRoot, "data");
export const corpusDir = join(dataDir, "corpus");
export const indexDir = join(dataDir, "index");
export const sftDir = join(dataDir, "sft");
export const evalDir = join(dataDir, "eval");

const CANONICAL_AGENTS = resolve(
  repoRoot,
  "..",
  "Kill-Chain-AI",
  "AGENTS.md",
);
const SNAPSHOT_AGENTS = join(toolsRoot, "constitution", "AGENTS.md");
const REPO_AGENTS = join(repoRoot, "AGENTS.md");

export function toPosix(p) {
  return p.split(sep).join("/");
}

export function repoRel(absPath) {
  const abs = resolve(absPath);
  const root = repoRoot.endsWith(sep) ? repoRoot : repoRoot + sep;
  const posixRoot = toPosix(root);
  const posixAbs = toPosix(abs);
  if (posixAbs.toLowerCase().startsWith(posixRoot.toLowerCase())) {
    return posixAbs.slice(posixRoot.length);
  }
  if (posixAbs.toLowerCase().startsWith(toPosix(toolsRoot).toLowerCase())) {
    return "tools/killchain-ai/" + toPosix(abs).slice(toPosix(toolsRoot).length + 1);
  }
  return posixAbs;
}

/**
 * Locate the canonical Kill Chain AI constitution.
 * Never synthesize a replacement — only return a file that actually exists.
 */
export function findAgentsMd() {
  const env = process.env.KILLCHAIN_AGENTS_MD;
  const candidates = [
    env ? resolve(env) : null,
    CANONICAL_AGENTS,
    SNAPSHOT_AGENTS,
    REPO_AGENTS,
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) {
      return {
        abs: p,
        rel: repoRel(p),
        canonical: resolve(p) === resolve(CANONICAL_AGENTS),
        source: p === env
          ? "env"
          : resolve(p) === resolve(CANONICAL_AGENTS)
            ? "canonical"
            : resolve(p) === resolve(SNAPSHOT_AGENTS)
              ? "snapshot"
              : "repo-root",
      };
    }
  }
  return null;
}

export const SCAN_ROOTS = [
  "src",
  "electron",
  "scripts",
  "docs",
];

export const SCAN_DOC_FILES = [
  "README.md",
  "docs/audio-state-machine.md",
  "docs/performance.md",
  "package.json",
];

export const IGNORE_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "dist-electron",
  "release",
  ".git",
  ".vite",
  ".cache",
  "data",
  "canvases",
]);
