/**
 * Runtime model discovery.
 *
 * Everything here is derived from what OpenCode actually reports on this machine.
 * We never hardcode a model lineup and never invent pricing, quota, or rate limits.
 *
 * Discovered against OpenCode 1.18.29:
 *   `opencode models`            -> one `provider/model` per line
 *   `opencode models --verbose`  -> `provider/model` line followed by a JSON block
 *
 * The verbose JSON carries provider-declared `cost`, `limit`, `capabilities` and
 * `status`. That is the only thing we are willing to call authoritative.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { findOpenCodeBin } from "../mission/opencode.mjs";
import { repoRoot } from "../paths.mjs";
import { ensureMediatorDirs, modelCatalogPath } from "./paths.mjs";

/** Cost provenance, so the UI can distinguish "declared free" from "unknown". */
export const COST_FREE = "FREE";
export const COST_PAID = "PAID";
export const COST_UNKNOWN = "UNKNOWN";

export function runOpenCodeCommand(args, { bin, cwd = repoRoot, timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin || findOpenCodeBin(), args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      resolve({ ok: false, stdout: "", stderr: String(err?.message || err), code: null, timedOut: false });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: stderr || String(err?.message || err), code: null, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, stdout, stderr, code, timedOut });
    });
  });
}

/**
 * Parse `opencode models --verbose`.
 *
 * Layout is a bare `provider/model` line, then a brace-balanced JSON object.
 * We brace-count rather than regex so nested objects survive intact.
 */
export function parseVerboseModels(raw) {
  const text = String(raw || "").replace(/\r/g, "");
  const lines = text.split("\n");
  const models = [];
  let ref = null;
  let buf = null;
  let depth = 0;
  for (const line of lines) {
    if (buf === null) {
      const t = line.trim();
      if (!t) continue;
      // Accept both the pretty-printed form (`{` alone) and single-line JSON.
      if (t.startsWith("{")) {
        buf = line;
        depth = 0;
        for (const ch of line) {
          if (ch === "{") depth += 1;
          else if (ch === "}") depth -= 1;
        }
        if (depth > 0) continue;
      } else {
        if (/^[A-Za-z0-9_.-]+\/\S+$/.test(t)) ref = t;
        continue;
      }
    } else {
      buf += `\n${line}`;
      for (const ch of line) {
        if (ch === "{") depth += 1;
        else if (ch === "}") depth -= 1;
      }
    }
    if (depth <= 0) {
      try {
        const parsed = JSON.parse(buf);
        models.push(normalizeCatalogEntry(ref, parsed));
      } catch {
        /* a malformed block is skipped rather than guessed at */
      }
      buf = null;
      ref = null;
    }
  }
  return models;
}

/** Parse the plain `opencode models` listing (ids only, no metadata). */
export function parsePlainModels(raw) {
  return String(raw || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[A-Za-z0-9_.-]+\/\S+$/.test(l))
    .map((id) => normalizeCatalogEntry(id, null));
}

function costClass(cost) {
  if (!cost || typeof cost !== "object") return COST_UNKNOWN;
  const { input, output } = cost;
  if (typeof input !== "number" || typeof output !== "number") return COST_UNKNOWN;
  if (input === 0 && output === 0) return COST_FREE;
  return COST_PAID;
}

export function normalizeCatalogEntry(ref, meta) {
  const composed = meta?.providerID && meta?.id ? `${meta.providerID}/${meta.id}` : "";
  const id = String(ref || composed).trim();
  const provider = id.includes("/") ? id.slice(0, id.indexOf("/")) : "";
  const caps = meta?.capabilities || null;
  return {
    id,
    provider,
    name: meta?.name || id,
    // `local` means the cost-zero reading is because it runs on this machine,
    // not because a hosted provider declared a zero price.
    local: provider === "ollama",
    cost: meta?.cost ?? null,
    costClass: meta ? costClass(meta.cost) : COST_UNKNOWN,
    status: meta?.status || "unknown",
    contextLimit: meta?.limit?.context ?? null,
    outputLimit: meta?.limit?.output ?? null,
    toolcall: caps ? Boolean(caps.toolcall) : null,
    reasoning: caps ? Boolean(caps.reasoning) : null,
    image: caps?.input ? Boolean(caps.input.image) : null,
    variants: meta?.variants && Object.keys(meta.variants).length ? Object.keys(meta.variants) : [],
    metadataAvailable: Boolean(meta),
  };
}

/**
 * Discover models from the live OpenCode install.
 * Falls back to the plain listing if verbose parsing yields nothing, and to the
 * on-disk cache if OpenCode cannot be reached at all.
 */
export async function discoverModels({ bin, cwd, timeoutMs = 120000, refresh = false, useCache = true } = {}) {
  const args = ["models", "--verbose"];
  if (refresh) args.push("--refresh");
  const res = await runOpenCodeCommand(args, { bin, cwd, timeoutMs });

  let models = res.ok ? parseVerboseModels(res.stdout) : [];
  let source = "opencode models --verbose";

  if (!models.length && res.ok) {
    const plain = await runOpenCodeCommand(["models"], { bin, cwd, timeoutMs });
    if (plain.ok) {
      models = parsePlainModels(plain.stdout);
      source = "opencode models";
    }
  }

  if (!models.length) {
    const cached = useCache ? readCatalog() : null;
    if (cached?.models?.length) {
      return {
        ok: false,
        stale: true,
        source: "cache",
        discoveredAt: cached.discoveredAt,
        error: res.timedOut ? "opencode models timed out" : res.stderr.trim() || "no models discovered",
        models: cached.models,
      };
    }
    return {
      ok: false,
      stale: false,
      source,
      discoveredAt: Date.now(),
      error: res.timedOut ? "opencode models timed out" : res.stderr.trim() || "no models discovered",
      models: [],
    };
  }

  const catalog = { ok: true, stale: false, source, discoveredAt: Date.now(), error: null, models };
  writeCatalog(catalog);
  return catalog;
}

export function writeCatalog(catalog) {
  ensureMediatorDirs();
  writeFileSync(modelCatalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  return catalog;
}

export function readCatalog() {
  if (!existsSync(modelCatalogPath)) return null;
  try {
    return JSON.parse(readFileSync(modelCatalogPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Role eligibility from declared capability only.
 *
 * FAST/DEEP need to hold a long evidence pack and emit structured text.
 * VISUAL needs declared image input. PUPPY stays local by design — the whole
 * point of the system is training the local worker, not replacing it.
 */
export function roleEligibility(model) {
  const active = model.status === "active" || model.status === "unknown";
  const ctx = model.contextLimit ?? 0;
  const supervisorBase = active && !model.local && (model.toolcall !== false);
  return {
    FAST_SUPERVISOR: Boolean(supervisorBase && ctx >= 100000),
    DEEP_SUPERVISOR: Boolean(supervisorBase && ctx >= 200000 && model.reasoning !== false),
    VISUAL_REVIEW: Boolean(active && model.image === true),
    ROBO_PUPPY: Boolean(active && model.local),
  };
}

export function eligibleFor(models, role) {
  return models.filter((m) => roleEligibility(m)[role]);
}

/** Candidates worth benchmarking for FAST: eligible AND provider-declared free. */
export function freeSupervisorCandidates(models) {
  return eligibleFor(models, "FAST_SUPERVISOR").filter((m) => m.costClass === COST_FREE);
}
