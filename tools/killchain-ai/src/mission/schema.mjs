import { readFileSync } from "node:fs";
import { isDangerPath } from "../corpus/subsystems.mjs";

export const LEVELS = {
  0: {
    id: 0,
    name: "read-only",
    edits: false,
    planRequired: true,
    criticRequired: true,
    audio: false,
  },
  1: {
    id: 1,
    name: "single-patch",
    edits: true,
    maxLogicalPatches: 1,
    planRequired: true,
    criticRequired: true,
    audio: false,
  },
  2: {
    id: 2,
    name: "bounded-feature",
    edits: true,
    planRequired: true,
    criticRequired: true,
    audio: false,
  },
  3: {
    id: 3,
    name: "multi-phase",
    edits: true,
    planRequired: true,
    criticRequired: true,
    audio: false,
  },
  4: {
    id: 4,
    name: "audio-critical",
    edits: true,
    planRequired: true,
    criticRequired: true,
    audio: true,
    humanBeforeEdit: true,
  },
};

export const LEVEL_ALIASES = {
  "read-only": 0,
  investigate: 0,
  "single-patch": 1,
  patch: 1,
  "bounded-feature": 2,
  feature: 2,
  "multi-phase": 3,
  "audio-critical": 4,
  audio: 4,
};

export const ALWAYS_FORBIDDEN = [
  ".git/**",
  "node_modules/**",
  "dist/**",
  "dist-electron/**",
  "release/**",
];

export const DEFAULT_AUDIO_FORBIDDEN = [
  "src/audio/AudioEngine.ts",
  "src/audio/dsp/**",
  "src/audio/AutoFlatten.ts",
  "src/audio/defaultCorrectionProfile.ts",
  "src/audio/headphoneProfiles.ts",
  "src/audio/deviceProfiles.ts",
  "src/audio/presets.ts",
  "src/audio/profiles/**",
  "src/lib/sourceArbiter.ts",
  "src/lib/tractorLock.ts",
  "src/lib/tractorAutoLock.ts",
  "src/lib/targetLock.ts",
  "src/lib/tractorBeam.ts",
  "src/lib/tractorLive.ts",
  "src/lib/adaptiveEngine.ts",
  "electron/main.ts",
  "electron/**",
];

export const DEFAULT_DEP_FORBIDDEN = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
];

export const ID_RE = /^[a-z0-9][a-z0-9-]{1,80}$/;

export function assertSafeMissionId(id) {
  if (!ID_RE.test(String(id || ""))) {
    throw new Error(`invalid mission id: ${id}`);
  }
  return id;
}

export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function toPosixRel(p) {
  return String(p || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

/** Glob-lite: `dir/**`, `*.ts`, or exact/prefix match. */
export function matchPath(rel, pattern) {
  const p = toPosixRel(rel);
  const g = toPosixRel(pattern);
  if (!g) return false;
  if (g.endsWith("/**")) {
    const prefix = g.slice(0, -3);
    return p === prefix || p.startsWith(`${prefix}/`);
  }
  if (g.includes("*")) {
    const re = new RegExp(`^${g.split("*").map(escapeRegex).join(".*")}$`);
    return re.test(p);
  }
  return p === g || p.startsWith(`${g}/`);
}

export function matchesAny(rel, patterns) {
  return (patterns || []).some((pat) => matchPath(rel, pat));
}

export function normalizeLevel(value) {
  if (value == null) return null;
  if (typeof value === "number" && LEVELS[value]) return value;
  const s = String(value).trim().toLowerCase();
  if (s in LEVEL_ALIASES) return LEVEL_ALIASES[s];
  const n = Number(s);
  if (LEVELS[n]) return n;
  return null;
}

function asStringList(v, field, errors) {
  if (v == null) return null;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    errors.push(`${field} must be an array of strings`);
    return null;
  }
  return v;
}

/**
 * Path array. Repo-relative, normalized, and rejected outright if it looks like
 * traversal, an absolute path, or a drive letter.
 */
function asPathArray(v, field, errors) {
  const list = asStringList(v, field, errors);
  if (!list) return [];
  const out = [];
  for (const raw of list) {
    const x = toPosixRel(String(raw).trim());
    if (!x) continue;
    if (x.includes("..") || /^[a-zA-Z]:/.test(x) || x.startsWith("/")) {
      errors.push(`${field} must be a repo-relative path without ..: ${x}`);
      continue;
    }
    out.push(x);
  }
  return out;
}

/**
 * Prose array. Ordinary mission language — acceptance criteria, stop conditions,
 * validation command names.
 *
 * These are NOT paths and must not be run through path validation. Doing so
 * rejected perfectly good criteria: a live Mediator-generated criterion reading
 * "declare vec3 ro = ... before line 61" was refused because the ellipsis
 * matched the traversal check. Hand-authored missions only passed by
 * coincidence. Text is preserved verbatim apart from trimming.
 */
function asProseArray(v, field, errors) {
  const list = asStringList(v, field, errors);
  if (!list) return [];
  return list.map((raw) => String(raw).trim()).filter(Boolean);
}

export function defaultForbidden(level) {
  const extra = level < 4 ? DEFAULT_AUDIO_FORBIDDEN : ["src/audio/dsp/**"];
  return [...ALWAYS_FORBIDDEN, ...DEFAULT_DEP_FORBIDDEN, ...extra];
}

export function normalizeMission(raw, { brief = "", source = "" } = {}) {
  const errors = [];
  const warnings = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["mission header must be a JSON object"], warnings, spec: null };
  }

  const id = String(raw.id || "").trim();
  if (!ID_RE.test(id)) errors.push("id must be kebab-case [a-z0-9-] (2–81 chars)");

  const title = String(raw.title || "").trim();
  if (!title) errors.push("title is required");

  const goal = String(raw.goal || "").trim();
  if (!goal) errors.push("goal is required");

  const level = normalizeLevel(raw.level);
  if (level == null) errors.push("level must be 0–4 or a known alias (read-only, single-patch, bounded-feature, multi-phase, audio-critical)");

  const allowedPaths = asPathArray(raw.allowedPaths, "allowedPaths", errors);
  const readOnlyPaths = asPathArray(raw.readOnlyPaths, "readOnlyPaths", errors);
  const forbiddenPaths = asPathArray(raw.forbiddenPaths, "forbiddenPaths", errors);
  const baselineDirtyPaths = asPathArray(raw.baselineDirtyPaths, "baselineDirtyPaths", errors);
  const adoptDirtyPaths = asPathArray(raw.adoptDirtyPaths, "adoptDirtyPaths", errors);
  const preserveDirtyPaths = asPathArray(raw.preserveDirtyPaths, "preserveDirtyPaths", errors);
  const acceptance = asProseArray(raw.acceptance, "acceptance", errors);
  const baseMissionId = String(raw.baseMissionId || "").trim();
  if (baseMissionId && !ID_RE.test(baseMissionId)) {
    errors.push(`baseMissionId must be kebab-case: ${baseMissionId}`);
  }
  const adoptCheckpoint = String(raw.adoptCheckpoint || "").trim();
  if (adoptCheckpoint && (adoptCheckpoint.includes("..") || adoptCheckpoint.startsWith("/") || /^[a-zA-Z]:/.test(adoptCheckpoint))) {
    errors.push(`adoptCheckpoint must be a mission-relative path without ..: ${adoptCheckpoint}`);
  }
  for (const p of adoptDirtyPaths) {
    if (!matchesAny(p, allowedPaths)) {
      errors.push(`adoptDirtyPaths includes "${p}" which is outside allowedPaths`);
    }
  }

  let validation = raw.validation || {};
  if (typeof validation !== "object" || Array.isArray(validation)) {
    errors.push("validation must be an object");
    validation = {};
  }
  const requiredVal = asProseArray(validation.required, "validation.required", errors);
  const optionalVal = asProseArray(validation.optional, "validation.optional", errors);

  const knownVal = new Set([
    "typecheck", "build", "smoke", "distort-hunt", "leak-check",
    "project-repro", "soak", "heap-diff",
  ]);
  for (const name of [...requiredVal, ...optionalVal]) {
    if (!knownVal.has(name)) errors.push(`unknown validation command: ${name}`);
  }

  const num = (v, fallback, field) => {
    if (v == null || v === "") return fallback;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) {
      errors.push(`${field} must be a non-negative number`);
      return fallback;
    }
    return n;
  };

  const modelRaw = String(raw.model || "").trim();
  if (modelRaw && (modelRaw.includes("..") || /[\n\r]/.test(modelRaw) || modelRaw.length > 120)) {
    errors.push("model must be a short provider/model id without path escape");
  }

  const commitPolicy = String(raw.commitPolicy || "none").trim();
  if (commitPolicy !== "none") {
    errors.push("commitPolicy must be \"none\" in this runner version (no auto-commits)");
  }

  const checkpointPolicy = String(raw.checkpointPolicy || "state-only").trim();
  if (!["state-only", "never"].includes(checkpointPolicy)) {
    errors.push("checkpointPolicy must be state-only or never");
  }

  const corpus = String(raw.corpus || "if-stale").trim();
  if (!["start", "never", "if-stale", "after-checkpoint"].includes(corpus)) {
    errors.push("corpus must be start | never | if-stale | after-checkpoint");
  }

  const allowAudioEdits = Boolean(raw.allowAudioEdits);
  const allowDependencyChange = Boolean(raw.allowDependencyChange);
  if (allowDependencyChange) {
    errors.push("allowDependencyChange is not enabled in this runner version");
  }

  if (level != null && level < 4 && allowAudioEdits) {
    errors.push("allowAudioEdits requires level 4 (audio-critical)");
  }

  if (level != null && level < 4) {
    for (const p of allowedPaths) {
      if (p.includes("src/audio/") || isDangerPath(p.replace(/\/\*\*$/, "")) || p.startsWith("src/audio/")) {
        errors.push(`allowedPaths includes audio/danger path "${p}" but level ${level} cannot edit audio`);
      }
      if (p === "electron/**" || p.startsWith("electron/")) {
        errors.push(`allowedPaths includes electron path "${p}" but level ${level} cannot edit electron/`);
      }
    }
  }

  if (level === 4 && !allowAudioEdits) {
    warnings.push("level 4 without allowAudioEdits: runner will BLOCK before any edit phase");
  }

  if (level != null && LEVELS[level]?.edits && !allowedPaths.length && !raw.dryRun) {
    warnings.push("edits are enabled but allowedPaths is empty — runner will refuse writes");
  }

  const spec = {
    id,
    title,
    goal,
    brief: String(brief || "").trim(),
    source,
    level,
    levelInfo: level != null ? LEVELS[level] : null,
    allowedPaths,
    readOnlyPaths,
    forbiddenPaths,
    baselineDirtyPaths,
    adoptDirtyPaths,
    preserveDirtyPaths: [...new Set([...preserveDirtyPaths, ...baselineDirtyPaths])],
    baseMissionId,
    adoptCheckpoint,
    acceptance,
    validation: {
      required: requiredVal,
      optional: optionalVal,
      restoreTsbuildinfo: validation.restoreTsbuildinfo !== false,
    },
    maxPhases: Math.max(1, num(raw.maxPhases, 8, "maxPhases")),
    maxRetriesPerPhase: Math.max(0, num(raw.maxRetriesPerPhase, 3, "maxRetriesPerPhase")),
    maxWallClockMs: num(raw.maxWallClockMs, 2 * 60 * 60 * 1000, "maxWallClockMs"),
    maxModelCalls: Math.max(1, num(raw.maxModelCalls, 24, "maxModelCalls")),
    implementationReserveCalls: raw.implementationReserveCalls == null
      ? null
      : Math.round(num(raw.implementationReserveCalls, 2, "implementationReserveCalls")),
    sessionTimeoutMs: num(raw.sessionTimeoutMs, 12 * 60 * 1000, "sessionTimeoutMs"),
    proposalRounds: Math.max(1, num(raw.proposalRounds, 1, "proposalRounds")),
    checkpointPolicy,
    commitPolicy: "none",
    corpus,
    model: modelRaw || "",
    allowAudioEdits,
    allowDependencyChange: false,
    dryRun: Boolean(raw.dryRun),
    diff: {
      maxFiles: num(raw.diff?.maxFiles, 40, "diff.maxFiles"),
      maxInsertions: num(raw.diff?.maxInsertions, 2500, "diff.maxInsertions"),
      warnOnly: raw.diff?.warnOnly !== false,
    },
    stopOn: asProseArray(raw.stopOn, "stopOn", errors),
    ux: raw.ux && typeof raw.ux === "object" ? raw.ux : null,
    audio: raw.audio && typeof raw.audio === "object" ? raw.audio : null,
  };

  return { ok: errors.length === 0, errors, warnings, spec };
}

export function parseMissionMarkdown(text, { source = "" } = {}) {
  const trimmed = String(text || "").replace(/^\uFEFF/, "").replace(/^\s+/, "");
  if (!trimmed.startsWith("---")) {
    return {
      ok: false,
      errors: ["mission file must start with JSON frontmatter between --- fences"],
      warnings: [],
      spec: null,
    };
  }
  const rest = trimmed.slice(3).replace(/^\r?\n/, "");
  const end = rest.search(/\r?\n---\s*(?:\r?\n|$)/);
  if (end < 0) {
    return { ok: false, errors: ["missing closing --- after JSON frontmatter"], warnings: [], spec: null };
  }
  const fm = rest.slice(0, end).trim();
  const body = rest.slice(end).replace(/^\r?\n---\s*/, "").replace(/^\r?\n/, "");
  let json;
  try {
    json = JSON.parse(fm);
  } catch (err) {
    return {
      ok: false,
      errors: [`frontmatter is not valid JSON: ${err.message}`],
      warnings: [],
      spec: null,
    };
  }
  return normalizeMission(json, { brief: body, source });
}

export function parseMissionFile(absPath) {
  const text = readFileSync(absPath, "utf8");
  return parseMissionMarkdown(text, { source: absPath });
}

export function effectiveForbidden(spec) {
  const base = defaultForbidden(spec.level ?? 0);
  const extra = spec.forbiddenPaths || [];
  const allowed = spec.allowedPaths || [];
  return [...new Set([...base, ...extra])].filter((pat) => {
    if (spec.level === 4 && spec.allowAudioEdits && allowed.some((a) => a === pat)) return false;
    return true;
  });
}

export function pathForbidden(rel, spec) {
  return matchesAny(rel, effectiveForbidden(spec));
}

export function pathReadable(rel, spec) {
  if (pathForbidden(rel, spec) && !matchesAny(rel, spec.readOnlyPaths) && !matchesAny(rel, spec.allowedPaths)) {
    return false;
  }
  if (matchesAny(rel, spec.readOnlyPaths) || matchesAny(rel, spec.allowedPaths)) return true;
  return !pathForbidden(rel, spec);
}

export function pathEditable(rel, spec, { dryRun = false } = {}) {
  if (dryRun) return false;
  if (!spec.levelInfo?.edits) return false;
  if (pathForbidden(rel, spec)) return false;
  if (matchesAny(rel, spec.readOnlyPaths)) return false;
  if (!spec.allowedPaths.length) return false;
  return matchesAny(rel, spec.allowedPaths);
}
