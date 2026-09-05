import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { dataDir, toolsRoot } from "../paths.mjs";

/**
 * Mediator runtime data lives under the tooling data dir, which is git-ignored
 * (tools/killchain-ai/.gitignore line 1: `data/`). Nothing here is production state.
 */
export const mediatorDataDir = join(dataDir, "mediator");
export const mediatorRunsDir = join(mediatorDataDir, "runs");
export const mediatorCallsDir = join(mediatorDataDir, "calls");
export const mediatorBenchDir = join(mediatorDataDir, "benchmark");

/** Durable training history (JSONL, append-only). */
export const trainingMemoryPath = join(mediatorDataDir, "training-memory.jsonl");
/** Observed model metrics (JSON, rewritten). */
export const modelRegistryPath = join(mediatorDataDir, "model-registry.json");
/** Cached provider model discovery. */
export const modelCatalogPath = join(mediatorDataDir, "model-catalog.json");
/** Mediator console session state, so truth survives a browser refresh. */
export const consoleStatePath = join(mediatorDataDir, "console-state.json");

/**
 * Identity assets are deliberately NOT under data/ — the Mediator's chosen
 * self-representation is a durable artifact, not a scratch run product.
 */
export const mediatorAssetsDir = join(toolsRoot, "assets", "mediator");
export const identityPath = join(mediatorAssetsDir, "identity.json");
export const themePath = join(mediatorAssetsDir, "theme.json");
export const avatarSvgPath = join(mediatorAssetsDir, "avatar.svg");
/** Raw model reply that produced the identity, kept for provenance. */
export const identitySourcePath = join(mediatorAssetsDir, "identity-source.txt");

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureMediatorDirs() {
  ensureDir(mediatorDataDir);
  ensureDir(mediatorRunsDir);
  ensureDir(mediatorCallsDir);
  ensureDir(mediatorBenchDir);
  return mediatorDataDir;
}
