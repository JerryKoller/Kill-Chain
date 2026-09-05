/**
 * Observed model metadata and role assignment.
 *
 * Every number in here comes from a call we actually made. Nothing is seeded,
 * estimated, or inherited from a model's reputation. A model with no recorded
 * calls reports nulls, not zeros — "unknown" and "bad" are different states and
 * the UI must be able to tell them apart.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { ensureMediatorDirs, modelRegistryPath } from "./paths.mjs";
import { roleEligibility } from "./modelDiscovery.mjs";
import { ROUTE_DEEP, ROUTE_FAST, ROUTE_VISUAL } from "./router.mjs";

const MAX_SAMPLES = 50;
const MAX_ERRORS = 10;

export const PUPPY_ROLE = "ROBO_PUPPY";

function emptyRegistry() {
  return {
    version: 1,
    updatedAt: null,
    roles: {
      [ROUTE_FAST]: null,
      [ROUTE_DEEP]: null,
      [ROUTE_VISUAL]: null,
      [PUPPY_ROLE]: "ollama/qwen3.5:9b",
    },
    models: {},
  };
}

export function loadRegistry() {
  if (!existsSync(modelRegistryPath)) return emptyRegistry();
  try {
    const parsed = JSON.parse(readFileSync(modelRegistryPath, "utf8"));
    return { ...emptyRegistry(), ...parsed, roles: { ...emptyRegistry().roles, ...(parsed.roles || {}) } };
  } catch {
    return emptyRegistry();
  }
}

export function saveRegistry(reg) {
  ensureMediatorDirs();
  reg.updatedAt = Date.now();
  writeFileSync(modelRegistryPath, `${JSON.stringify(reg, null, 2)}\n`, "utf8");
  return reg;
}

function entry(reg, modelId) {
  if (!reg.models[modelId]) {
    reg.models[modelId] = { calls: 0, ok: 0, structuredValid: 0, structuredAttempts: 0, timeouts: 0, latencies: [], errors: [], lastCallAt: null };
  }
  return reg.models[modelId];
}

/**
 * Record one real invocation.
 * `structuredValid` is only counted when the call was also a protocol attempt,
 * so benchmark and identity calls do not distort each other.
 */
export function recordCall(reg, modelId, { ok, durationMs, timedOut = false, structuredAttempt = false, structuredValid = false, error = null } = {}) {
  const e = entry(reg, modelId);
  e.calls += 1;
  e.lastCallAt = Date.now();
  if (ok) e.ok += 1;
  if (timedOut) e.timeouts += 1;
  if (structuredAttempt) {
    e.structuredAttempts += 1;
    if (structuredValid) e.structuredValid += 1;
  }
  if (Number.isFinite(durationMs)) {
    e.latencies.push(Math.round(durationMs));
    if (e.latencies.length > MAX_SAMPLES) e.latencies = e.latencies.slice(-MAX_SAMPLES);
  }
  if (error) {
    e.errors.push({ at: Date.now(), error: String(error).slice(0, 300) });
    if (e.errors.length > MAX_ERRORS) e.errors = e.errors.slice(-MAX_ERRORS);
  }
  return e;
}

export function median(values) {
  const nums = (values || []).filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : Math.round((nums[mid - 1] + nums[mid]) / 2);
}

/** Derived metrics. Returns nulls where we have no observations. */
export function modelMetrics(reg, modelId) {
  const e = reg.models[modelId];
  if (!e || !e.calls) {
    return { calls: 0, medianLatencyMs: null, successRate: null, structuredOutputRate: null, timeoutRate: null, recentErrors: [], lastCallAt: null };
  }
  return {
    calls: e.calls,
    medianLatencyMs: median(e.latencies),
    successRate: e.ok / e.calls,
    structuredOutputRate: e.structuredAttempts ? e.structuredValid / e.structuredAttempts : null,
    timeoutRate: e.timeouts / e.calls,
    recentErrors: e.errors.slice(-3),
    lastCallAt: e.lastCallAt,
  };
}

export function assignRole(reg, role, modelId) {
  reg.roles[role] = modelId || null;
  return reg;
}

export function roleModel(reg, role) {
  return reg.roles?.[role] || null;
}

/**
 * Merge the live catalog with what we have observed.
 * Catalog facts stay separate from observed facts so the UI never presents a
 * provider claim and a measurement as the same kind of thing.
 */
export function registryView(reg, catalog) {
  const models = (catalog?.models || []).map((m) => ({
    ...m,
    observed: modelMetrics(reg, m.id),
    eligible: roleEligibility(m),
    roles: Object.entries(reg.roles).filter(([, id]) => id === m.id).map(([r]) => r),
  }));
  return {
    updatedAt: reg.updatedAt,
    roles: reg.roles,
    catalogSource: catalog?.source || null,
    catalogDiscoveredAt: catalog?.discoveredAt || null,
    catalogStale: Boolean(catalog?.stale),
    catalogError: catalog?.error || null,
    models,
  };
}
