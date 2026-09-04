import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findAgentsMd, corpusDir, repoRoot } from "../paths.mjs";
import { gitCapture } from "../git.mjs";
import { ollamaTags } from "../eval/ollama.mjs";
import { matchesAny, parseMissionFile } from "./schema.mjs";
import { classifyPorcelain, gitPorcelain, snapshotWorktree } from "./gitops.mjs";
import {
  adoptionPreflightErrors,
  loadAdoptCheckpoint,
  loadParentMission,
  resolveAdoption,
} from "./attribution.mjs";
import { findOpenCodeBin, opencodeMcpList, opencodeVersion } from "./opencode.mjs";
import { ollamaHasModel } from "./model.mjs";

const EXPECTED_BRANCH = process.env.KC_MISSION_BRANCH || "ai/kill-chain-agent";

export function loadCorpusManifest() {
  const p = join(corpusDir, "manifest.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function corpusStale(manifest, head) {
  if (!manifest) return true;
  if (!existsSync(join(corpusDir, "chunks.jsonl"))) return true;
  if (head && manifest.gitCommit && manifest.gitCommit !== head) return true;
  return false;
}

export async function checkOllama(model = "qwen3.5:9b") {
  try {
    const tags = await ollamaTags();
    const names = (tags.models || tags.tags || []).map((m) => m.name || m.model || m);
    const ok = ollamaHasModel(names, model);
    return { ok, names, error: ok ? null : `model ${model} not in ollama tags` };
  } catch (err) {
    return { ok: false, names: [], error: String(err.message || err) };
  }
}

/**
 * Deterministic preflight. Does not let the model decide to overwrite a dirty app tree.
 */
export async function runPreflight(spec, deps = {}) {
  const errors = [];
  const warnings = [];
  const git = deps.gitCapture ? deps.gitCapture() : gitCapture();
  const porcelain = deps.gitPorcelain ? deps.gitPorcelain() : gitPorcelain();
  const classified = classifyPorcelain(porcelain);

  if (!git.commit) errors.push("unable to read git HEAD");
  if (EXPECTED_BRANCH && git.branch && git.branch !== EXPECTED_BRANCH) {
    errors.push(`branch is ${git.branch}, expected ${EXPECTED_BRANCH}`);
  }

  const appDirty = classified.app.filter((r) => r.path !== "tsconfig.tsbuildinfo");
  const dataRoot = deps.missionsDataDir || undefined;
  const parent = spec.baseMissionId
    ? (deps.loadParentMission ? deps.loadParentMission(spec.baseMissionId) : loadParentMission(spec.baseMissionId, dataRoot))
    : null;
  const checkpoint = spec.adoptCheckpoint
    ? (deps.loadAdoptCheckpoint ? deps.loadAdoptCheckpoint(spec) : loadAdoptCheckpoint(spec, dataRoot))
    : { files: [], error: null };
  if (checkpoint.error) errors.push(checkpoint.error);
  const resolved = deps.resolveAdoption
    ? deps.resolveAdoption(spec, porcelain, { parent, checkpointFiles: checkpoint.files })
    : resolveAdoption(spec, porcelain, { parent, checkpointFiles: checkpoint.files });
  errors.push(...(resolved.errors || []));
  errors.push(...adoptionPreflightErrors({ ...resolved, errors: [] }));
  if (resolved.adopted?.length || resolved.preserved?.length) {
    warnings.push(
      `worktree dirt classified adopted=${(resolved.adopted || []).join(",") || "(none)"} preserved=${(resolved.preserved || []).join(",") || "(none)"}`,
    );
  }

  const agents = findAgentsMd();
  if (!agents) errors.push("AGENTS.md not found");
  else if (!agents.canonical) warnings.push(`AGENTS.md source is ${agents.source}, not canonical`);

  const parsed = spec._parsedOk === false
    ? { ok: false, errors: spec._parseErrors || ["invalid spec"] }
    : { ok: true, errors: [] };
  if (!parsed.ok) errors.push(...parsed.errors);

  if (!spec.id || spec.level == null) errors.push("mission spec invalid");

  let ollama = { ok: true };
  if (deps.checkOllama) ollama = await deps.checkOllama();
  else ollama = await checkOllama(deps.model || "qwen3.5:9b");
  if (!ollama.ok) errors.push(`Ollama: ${ollama.error || "unreachable"}`);

  let oc = { ok: true, version: null };
  if (deps.opencodeVersion) {
    try {
      oc.version = await deps.opencodeVersion();
    } catch (err) {
      oc = { ok: false, error: String(err.message || err) };
    }
  } else {
    try {
      oc.version = await opencodeVersion(findOpenCodeBin());
    } catch (err) {
      oc = { ok: false, error: String(err.message || err) };
    }
  }
  if (!oc.ok && oc.error) errors.push(`OpenCode: ${oc.error}`);

  let mcp = { connected: true };
  if (deps.opencodeMcpList) mcp = await deps.opencodeMcpList();
  else mcp = await opencodeMcpList();
  if (!mcp.connected) errors.push(`Kill Chain MCP not connected (${(mcp.line || mcp.text || "").slice(0, 180)})`);

  const manifest = deps.loadCorpusManifest ? deps.loadCorpusManifest() : loadCorpusManifest();
  const stale = corpusStale(manifest, git.commit);
  const corpusPolicy = spec.corpus || "if-stale";
  const needRebuild = corpusPolicy === "start" || (corpusPolicy === "if-stale" && stale) || (corpusPolicy === "after-checkpoint" && stale && !manifest);
  if (corpusPolicy !== "never" && !manifest) warnings.push("corpus missing");
  if (stale && corpusPolicy === "never") warnings.push("corpus stale but policy=never");

  const snapshot = deps.snapshotWorktree ? deps.snapshotWorktree() : snapshotWorktree();

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    git,
    porcelain,
    classified,
    agents,
    ollama,
    opencode: oc,
    mcp,
    manifest,
    corpusStale: stale,
    needRebuild,
    snapshot,
    repoRoot,
    adoption: resolved,
  };
}

/** @deprecated dirty allowlist is not automatically expected; use resolveAdoption. */
export function isExpectedAppDirty(rel, spec) {
  if (!rel || rel === "tsconfig.tsbuildinfo") return true;
  if (matchesAny(rel, spec.adoptDirtyPaths || [])) return true;
  if (matchesAny(rel, spec.preserveDirtyPaths || spec.baselineDirtyPaths || [])) return true;
  return false;
}

export function parseSpecOrError(absPath) {
  const parsed = parseMissionFile(absPath);
  if (!parsed.ok) {
    const err = new Error(`invalid mission spec: ${parsed.errors.join("; ")}`);
    err.parse = parsed;
    throw err;
  }
  return parsed;
}
