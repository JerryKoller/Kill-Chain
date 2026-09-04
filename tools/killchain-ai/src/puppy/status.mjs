/**
 * ROBO PUPPY — human-facing identity for the local autonomous developer.
 *
 * The name is the agent identity; `ollama/qwen3.5:9b` is the implementation
 * detail. Technical logs keep using the model id.
 *
 * Everything here is DERIVED FROM REAL mission-runner state on disk. Nothing
 * is invented: if a field is unknown it reports "—" rather than a plausible
 * value. Faking a green BUILD: PASS would make this ornament instead of
 * instrumentation.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../paths.mjs";

export const AGENT_NAME = "ROBO PUPPY";
export const AGENT_TITLE = "Kill Chain Autonomous Development Agent";

/** Display states, as requested. Mapped from the runner's real 15 states. */
export const PUPPY_STATES = [
  "IDLE",
  "INVESTIGATING",
  "PLANNING",
  "EDITING",
  "VALIDATING",
  "REPAIRING",
  "CRITIQUING",
  "CHECKPOINTING",
  "BLOCKED",
  "COMPLETE",
  "WAITING_FOR_TEACHER",
];

/**
 * Real runner state -> display state.
 * PROPOSING collapses into PLANNING and DIFF_REVIEW into VALIDATING because
 * those are the same activity from a human's point of view; every other state
 * maps one-to-one so the display never hides a distinction that matters.
 */
const STATE_MAP = {
  CREATED: "IDLE",
  PREFLIGHT: "IDLE",
  INVESTIGATING: "INVESTIGATING",
  PLANNING: "PLANNING",
  PROPOSING: "PLANNING",
  PLAN_REVIEW: "CRITIQUING",
  EDITING: "EDITING",
  DIFF_REVIEW: "VALIDATING",
  VALIDATING: "VALIDATING",
  REPAIRING: "REPAIRING",
  CHECKPOINT: "CHECKPOINTING",
  FINAL_REVIEW: "CRITIQUING",
  COMPLETE: "COMPLETE",
  BLOCKED: "BLOCKED",
  FAILED: "BLOCKED",
};

/** One line of personality, chosen by real state. Never contradicts the data. */
const MOOD = {
  IDLE: "Waiting for a job.",
  INVESTIGATING: "Nose down, reading the code.",
  PLANNING: "Working out where to dig.",
  EDITING: "Writing TypeScript. Actually writing it.",
  VALIDATING: "Holding still for the compiler.",
  REPAIRING: "Fixing his own mess.",
  CRITIQUING: "Trying to prove himself wrong.",
  CHECKPOINTING: "Burying a copy in the yard.",
  BLOCKED: "Stopped on purpose. Needs a human.",
  COMPLETE: "Good puppy. Build passed.",
  WAITING_FOR_TEACHER: "Sitting patiently for the senior engineer.",
};

function readJson(p) {
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  } catch {
    return null;
  }
}

/** Most recently updated mission on disk. */
export function latestMissionId() {
  const root = join(dataDir, "missions");
  if (!existsSync(root)) return null;
  let best = null;
  for (const id of readdirSync(root)) {
    const sp = join(root, id, "status.json");
    if (!existsSync(sp)) continue;
    let mtime = 0;
    try {
      mtime = statSync(sp).mtimeMs;
    } catch {
      continue;
    }
    if (!best || mtime > best.mtime) best = { id, mtime };
  }
  return best?.id || null;
}

/**
 * Build a status card from real mission state.
 *
 * Every returned field carries a `real` flag so a caller can tell measured
 * values from mapped ones. `null` means genuinely unknown.
 */
export function puppyStatus({ missionId = null } = {}) {
  const id = missionId || latestMissionId();
  if (!id) {
    return {
      agent: AGENT_NAME,
      title: AGENT_TITLE,
      state: "IDLE",
      mood: MOOD.IDLE,
      missionId: null,
      fields: [],
      note: "No mission state on disk yet.",
    };
  }

  const dir = join(dataDir, "missions", id);
  const status = readJson(join(dir, "status.json"));
  const mission = readJson(join(dir, "mission.json"));
  if (!status) {
    return {
      agent: AGENT_NAME,
      title: AGENT_TITLE,
      state: "IDLE",
      mood: MOOD.IDLE,
      missionId: id,
      fields: [],
      note: `No status.json for ${id}.`,
    };
  }

  const runnerState = String(status.state || "CREATED").toUpperCase();
  // A teacher packet on disk with the mission stopped means it is genuinely
  // waiting for senior input, which the raw state cannot express.
  const teacherPending = existsSync(join(dir, "teacher", "QUESTIONS.md"))
    || existsSync(join(dir, "TEACHER_PACKET.md"));
  const state = teacherPending && (runnerState === "BLOCKED" || runnerState === "REPAIRING")
    ? "WAITING_FOR_TEACHER"
    : (STATE_MAP[runnerState] || "IDLE");

  const gate = readJson(join(dir, "critic-gate.json"));
  const finalGate = readJson(join(dir, "final-critic-gate.json"));
  const validation = readJson(join(dir, "validation.json"));

  const criticDisplay = (() => {
    const g = finalGate || gate;
    if (!g) return null;
    if (g.pass) return "PASS";
    if (g.modelVerdict === "BLOCK") return "BLOCK";
    return g.errors?.length ? "REVISING" : (g.modelVerdict || null);
  })();

  const buildDisplay = (() => {
    if (!validation) return null;
    const results = validation.results || [];
    const build = results.find((r) => /build/i.test(r.name || ""));
    const tc = results.find((r) => /typecheck/i.test(r.name || ""));
    const pick = build || tc;
    if (!pick) return validation.ok === true ? "PASS" : (validation.ok === false ? "FAIL" : null);
    return pick.ok ? "PASS" : "FAIL";
  })();

  const fields = [
    { label: "STATUS", value: state, real: true, from: `status.json state=${runnerState}` },
    { label: "MISSION", value: mission?.title || id, real: true, from: "mission.json title" },
    { label: "PHASE", value: runnerState, real: true, from: "status.json state" },
    { label: "MODEL", value: status.model || mission?.model || "ollama/qwen3.5:9b", real: Boolean(status.model || mission?.model), from: "status.json model" },
    { label: "BUILD", value: buildDisplay, real: Boolean(validation), from: "validation.json" },
    { label: "CRITIC", value: criticDisplay, real: Boolean(finalGate || gate), from: "critic-gate.json" },
    { label: "CHECKPOINT", value: Array.isArray(status.checkpoints) ? String(status.checkpoints.length).padStart(2, "0") : null, real: Array.isArray(status.checkpoints), from: "status.json checkpoints" },
    { label: "MODEL CALLS", value: Number.isFinite(status.modelCalls) ? String(status.modelCalls) : null, real: Number.isFinite(status.modelCalls), from: "status.json modelCalls" },
  ];

  return {
    agent: AGENT_NAME,
    title: AGENT_TITLE,
    state,
    mood: MOOD[state] || "",
    missionId: id,
    runnerState,
    blockedReason: status.blockedReason || status.failedReason || null,
    counters: {
      modelCalls: status.modelCalls ?? null,
      emptyEdits: status.emptyEdits ?? null,
      syntaxFailures: status.syntaxFailures ?? null,
      unixViolations: status.unixViolations ?? null,
      repairRetries: status.repairRetries ?? null,
      resumeCount: status.resumeCount ?? null,
    },
    fields,
    updatedAt: status.updatedAt || null,
  };
}

/** Terminal card. Data stays plain; the personality is one line at the end. */
export function renderTerminal(s) {
  const W = 62;
  const line = (ch = "─") => ch.repeat(W);
  const row = (label, value) => `  ${label.padEnd(13)} ${value === null || value === undefined ? "—" : value}`;
  const out = [];
  out.push(line("━"));
  out.push(`  ${s.agent}`);
  out.push(`  ${s.title}`);
  out.push(line());
  for (const f of s.fields) out.push(row(f.label, f.value));
  if (s.blockedReason) out.push(row("REASON", s.blockedReason));
  out.push(line());
  const suspicious = [];
  if (s.counters?.emptyEdits) suspicious.push(`${s.counters.emptyEdits} empty edit(s)`);
  if (s.counters?.syntaxFailures) suspicious.push(`${s.counters.syntaxFailures} syntax failure(s)`);
  if (s.counters?.unixViolations) suspicious.push(`${s.counters.unixViolations} unix violation(s)`);
  if (suspicious.length) out.push(`  flags: ${suspicious.join(", ")}`);
  out.push(`  ${s.mood}`);
  out.push(line("━"));
  if (s.note) out.push(`  ${s.note}`);
  return out.join("\n");
}
