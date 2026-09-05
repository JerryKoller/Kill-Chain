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
import { isTerminal } from "../mission/machine.mjs";
import { pidAlive, readLock } from "../mission/store.mjs";

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

/** Runner / invoke phase → what he is doing, in human words. */
export const ACTIVITY = {
  CREATED: "Getting ready",
  PREFLIGHT: "Running preflight",
  INVESTIGATING: "Reading the code",
  PLANNING: "Writing a plan",
  PROPOSING: "Writing a plan",
  PLAN_REVIEW: "Critiquing his plan",
  EDITING: "Editing the authorized file",
  DIFF_REVIEW: "Checking his own diff",
  VALIDATING: "Waiting on typecheck / build",
  REPAIRING: "Repairing a failed edit",
  CHECKPOINT: "Writing a checkpoint",
  FINAL_REVIEW: "Final critic pass",
  COMPLETE: "Finished",
  BLOCKED: "Stopped — needs a human",
  FAILED: "Stopped — failed",
  investigate: "Reading the code",
  plan: "Writing a plan",
  "plan-empty-retry": "Retrying a thin plan",
  "plan-critic": "Critiquing his plan",
  edit: "Editing the authorized file",
  "edit-retry": "Retrying an edit",
  repair: "Repairing a failed edit",
  "repair-diagnose": "Diagnosing a failed edit",
  critic: "Critiquing the work",
  "final-critic": "Final critic pass",
  validate: "Waiting on typecheck / build",
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

export function median(nums) {
  const a = (nums || []).filter((n) => Number.isFinite(n) && n > 0).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

export function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  if (ms <= 0) return "done";
  const s = Math.round(ms / 1000);
  if (s < 90) return `~${s}s`;
  const min = Math.round(s / 60);
  if (min < 60) return `~${min} min`;
  const h = Math.floor(min / 60);
  const rm = min % 60;
  return rm ? `~${h}h ${rm}m` : `~${h}h`;
}

/**
 * ETA is DERIVED, never a number the model wrote down.
 * Prefers median duration of HIS completed calls × remaining call budget,
 * capped by the mission wall-clock. null if we have no numbers.
 */
export function estimateEta({
  state,
  startedAt,
  invocations = [],
  modelCalls = 0,
  maxModelCalls = 0,
  maxWallClockMs = 0,
  now = Date.now(),
} = {}) {
  const runnerState = String(state || "").toUpperCase();
  if (isTerminal(runnerState)) {
    return {
      remainingMs: 0,
      label: "done",
      derived: true,
      from: "terminal state",
      confidence: "exact",
    };
  }
  const started = Date.parse(startedAt);
  const elapsed = Number.isFinite(started) ? Math.max(0, now - started) : null;
  const budgetLeft = maxWallClockMs && elapsed != null ? Math.max(0, maxWallClockMs - elapsed) : null;
  const durs = (invocations || []).map((i) => i.durationMs).filter((n) => Number.isFinite(n) && n > 0);
  const typical = median(durs);
  const leftCalls = Math.max(0, (Number(maxModelCalls) || 0) - (Number(modelCalls) || 0));
  const fromCalls = typical != null && leftCalls > 0 ? typical * leftCalls : null;
  let remainingMs = null;
  let from = "no call history or wall-clock budget yet";
  let confidence = "none";
  if (fromCalls != null && budgetLeft != null) {
    remainingMs = Math.min(fromCalls, budgetLeft);
    from = `median of ${durs.length} of his calls × ${leftCalls} remaining, capped by wall-clock budget`;
    confidence = durs.length >= 2 ? "from-his-calls" : "budget-only";
  } else if (fromCalls != null) {
    remainingMs = fromCalls;
    from = `median of ${durs.length} of his calls × ${leftCalls} remaining`;
    confidence = durs.length >= 2 ? "from-his-calls" : "budget-only";
  } else if (budgetLeft != null) {
    remainingMs = budgetLeft;
    from = "mission maxWallClockMs remaining (no call history yet)";
    confidence = "budget-only";
  } else {
    return { remainingMs: null, label: null, derived: true, from, confidence };
  }
  return {
    remainingMs,
    label: formatDuration(remainingMs),
    derived: true,
    from,
    typicalCallMs: typical,
    callsLeft: leftCalls,
    budgetLeftMs: budgetLeft,
    elapsedMs: elapsed,
    confidence,
  };
}

export function readJournal(dir, limit = 8) {
  try {
    const raw = existsSync(join(dir, "JOURNAL.md")) ? readFileSync(join(dir, "JOURNAL.md"), "utf8") : "";
    const out = [];
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^-+\s+(\d{4}-\d{2}-\d{2}T[^\s]+)\s+(.*)$/);
      if (!m) continue;
      out.push({ at: m[1], text: m[2].trim() });
    }
    return out.slice(-Math.max(1, limit));
  } catch {
    return [];
  }
}

/**
 * One entertaining line. Always a function of real state / flags.
 * Never claims a build passed, a critic passed, or that he is working
 * unless the payload already says so.
 */
export function barkLine(s) {
  const reason = s?.blockedReason || "";
  const chewed = /read-only/i.test(s?.lastError || "");
  if (!s?.missionId) return "Waiting by the door.";
  if (s.state === "WAITING_FOR_TEACHER") return "Sitting. Teacher has the ball.";
  if (s.state === "COMPLETE") return "Good puppy. Build passed. Treats?";
  if (s.state === "BLOCKED") {
    if (/missing-verdict/i.test(reason)) {
      return chewed
        ? "He thought very hard, forgot to say VERDICT, and chewed a file we had to put back."
        : "He thought very hard and forgot to say VERDICT.";
    }
    if (/EMPTY_EDIT/i.test(reason)) return "He described a hole and did not dig it.";
    if (chewed) return "Stopped. He wrote during a read-only walk. We restored the file.";
    if (reason) return "Stopped on purpose. The leash is in your hand.";
    return MOOD.BLOCKED;
  }
  if (s.counters?.emptyEdits && s.state === "EDITING") return "Writing TypeScript. Actually writing it. (He has ghosted an edit before.)";
  if (s.working && s.lastInvokePhase === "plan-critic") return "Trying to prove himself wrong. Tail still wagging.";
  if (s.working && s.lastInvokePhase === "plan-empty-retry") return "The last plan was too thin. Chewing it again.";
  if (s.working && s.lastInvokePhase === "investigate") return "Nose down in the corpus. Do not tap the glass.";
  if (s.working && s.lastInvokePhase === "edit") return "Paws on the keyboard. One authorized file only.";
  if (s.working && s.lastInvokePhase === "repair") return "Licking the wound he just made.";
  if (s.working && s.lastInvokePhase === "validate") return "Statue mode. Compiler has the ball.";
  if (s.working && (s.lastInvokePhase === "critic" || s.lastInvokePhase === "final-critic")) {
    return "Final stare. If he blinks first, the critic wins.";
  }
  return s.mood || MOOD[s.state] || "On the leash.";
}

export function asideLine(s) {
  const c = s?.counters || {};
  if (c.unixViolations >= 10) return `Unix on Windows. ${c.unixViolations} nips and counting.`;
  if (c.readOnlyViolations) return `${c.readOnlyViolations} leash yank(s). He wrote when he was only allowed to sniff.`;
  if (c.emptyEdits) return `${c.emptyEdits} empty edit(s). All bark, no bytes.`;
  if (c.syntaxFailures) return `${c.syntaxFailures} syntax failure(s). The compiler growled back.`;
  if (c.automaticRestores) return `${c.automaticRestores} restore(s). We put the furniture back.`;
  if (c.mcpFirstMisses) return `${c.mcpFirstMisses} MCP-first miss(es). He reached for bash again.`;
  if (c.planRetries) return `${c.planRetries} thin-plan chew(s).`;
  return null;
}

export function disciplineChips(s) {
  const c = s?.counters || {};
  const chips = [];
  const add = (n, label) => {
    if (Number.isFinite(n) && n > 0) chips.push({ n, label });
  };
  add(c.unixViolations, "unix nips");
  add(c.mcpFirstMisses, "MCP-first misses");
  add(c.readOnlyViolations, "leash yanks");
  add(c.automaticRestores, "restores");
  add(c.planRetries, "thin-plan chews");
  add(c.emptyEdits, "empty edits");
  add(c.syntaxFailures, "syntax");
  add(c.visibleTextMisses, "silent fetches");
  add(c.criticRetries, "critic retries");
  add(c.resumeCount, "resumes");
  return chips;
}

function emptyWatch(extra = {}) {
  return {
    agent: AGENT_NAME,
    title: AGENT_TITLE,
    state: "IDLE",
    mood: MOOD.IDLE,
    missionId: null,
    fields: [],
    working: false,
    finished: false,
    activity: "Waiting for a job.",
    workingOn: "No mission yet.",
    speech: "Waiting by the door.",
    aside: null,
    journal: [],
    lastCall: null,
    lastError: null,
    callHistory: [],
    discipline: [],
    allowedPaths: [],
    phaseTrail: [],
    eta: { remainingMs: null, label: null, derived: true, from: "no mission", confidence: "none" },
    fetchedAt: Date.now(),
    ...extra,
  };
}

/**
 * Build a status card from real mission state.
 *
 * Every returned field carries a `real` flag so a caller can tell measured
 * values from mapped ones. `null` means genuinely unknown.
 */
export function puppyStatus({ missionId = null } = {}) {
  const id = missionId || latestMissionId();
  if (!id) return emptyWatch({ note: "No mission state on disk yet." });

  const dir = join(dataDir, "missions", id);
  const status = readJson(join(dir, "status.json"));
  const mission = readJson(join(dir, "mission.json"));
  if (!status) return emptyWatch({ missionId: id, note: `No status.json for ${id}.` });

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
    if (g.modelVerdict === "FAIL") return "FAIL";
    if (g.errors?.length && !isTerminal(runnerState)) return "REVISING";
    return g.modelVerdict || (g.errors?.length ? "FAIL" : null);
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
    { label: "CHECKPOINT", value: Array.isArray(status.checkpoints)
      ? String(status.checkpoints.length).padStart(2, "0")
      : (Number.isFinite(status.checkpoints) ? String(status.checkpoints).padStart(2, "0") : null),
      real: Array.isArray(status.checkpoints) || Number.isFinite(status.checkpoints), from: "status.json checkpoints" },
    { label: "MODEL CALLS", value: Number.isFinite(status.modelCalls) ? String(status.modelCalls) : null, real: Number.isFinite(status.modelCalls), from: "status.json modelCalls" },
  ];

  const lock = readLock(dir);
  const lockAlive = Boolean(lock?.pid && pidAlive(lock.pid));
  const finished = isTerminal(runnerState) || Boolean(status.endedAt);
  const working = lockAlive && !finished;
  const invocations = Array.isArray(status.invocations) ? status.invocations : [];
  const lastInvoke = invocations.length ? invocations[invocations.length - 1] : null;
  const activityKey = working && lastInvoke?.phase ? lastInvoke.phase : runnerState;
  const activity = ACTIVITY[activityKey] || ACTIVITY[runnerState] || runnerState;
  const job = mission?.title || id;
  const workingOn = finished
    ? `${job} — ${activity}`
    : `${activity} · ${job}`;
  const eta = estimateEta({
    state: runnerState,
    startedAt: status.startedAt,
    invocations,
    modelCalls: status.modelCalls,
    maxModelCalls: mission?.maxModelCalls,
    maxWallClockMs: mission?.maxWallClockMs,
  });
  const phaseFile = existsSync(join(dir, "CURRENT_PHASE.md"))
    ? readFileSync(join(dir, "CURRENT_PHASE.md"), "utf8").trim().split(/\r?\n/)[0]
    : null;
  const journal = readJournal(dir, 8);
  const trail = (status.transitions || []).slice(-8).map((t) => ({
    from: t.from, to: t.to, note: t.note || "", at: t.at || null,
  }));
  const lastCall = lastInvoke
    ? {
      n: lastInvoke.n ?? null,
      phase: lastInvoke.phase || null,
      title: lastInvoke.title || null,
      durationMs: lastInvoke.durationMs ?? null,
      tools: Array.isArray(lastInvoke.tools) ? lastInvoke.tools.slice(0, 8) : [],
      firstTool: lastInvoke.firstTool || null,
      textChars: lastInvoke.textChars ?? null,
      ok: lastInvoke.ok !== false,
      unix: lastInvoke.unix ?? null,
      mcpFirst: lastInvoke.mcpFirst ?? null,
    }
    : null;
  const callHistory = invocations.slice(-16).map((i) => ({
    n: i.n ?? null,
    phase: i.phase || null,
    durationMs: Number.isFinite(i.durationMs) ? i.durationMs : null,
    ok: i.ok !== false,
  }));
  const payload = {
    agent: AGENT_NAME,
    title: AGENT_TITLE,
    state,
    mood: MOOD[state] || "",
    missionId: id,
    runnerState,
    blockedReason: status.blockedReason || status.failedReason || null,
    working,
    finished,
    activity,
    workingOn,
    detail: phaseFile || (journal.length ? journal[journal.length - 1].text : null),
    lastInvokePhase: lastInvoke?.phase || null,
    lastCall,
    lastError: status.lastError || null,
    callHistory,
    journal,
    phaseTrail: trail,
    allowedPaths: Array.isArray(mission?.allowedPaths) ? mission.allowedPaths : [],
    model: status.model || mission?.model || "ollama/qwen3.5:9b",
    eta,
    fetchedAt: Date.now(),
    startedAt: status.startedAt || null,
    endedAt: status.endedAt || null,
    lockPid: lock?.pid || null,
    counters: {
      modelCalls: status.modelCalls ?? null,
      maxModelCalls: mission?.maxModelCalls ?? null,
      emptyEdits: status.emptyEdits ?? null,
      syntaxFailures: status.syntaxFailures ?? null,
      unixViolations: status.unixViolations ?? null,
      mcpFirstMisses: status.mcpFirstMisses ?? null,
      automaticRestores: status.automaticRestores ?? null,
      repairRetries: status.repairRetries ?? null,
      planRetries: status.planRetries ?? null,
      criticRetries: status.criticRetries ?? null,
      editRetries: status.editRetries ?? null,
      resumeCount: status.resumeCount ?? null,
      readOnlyViolations: status.readOnlyViolations ?? null,
      visibleTextMisses: status.visibleTextMisses ?? null,
    },
    fields,
    updatedAt: status.updatedAt || null,
  };
  payload.speech = barkLine(payload);
  payload.aside = asideLine(payload);
  payload.discipline = disciplineChips(payload);
  return payload;
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
  out.push(row("WORKING", s.working ? "YES" : "NO"));
  out.push(row("NOW", s.workingOn || s.activity || null));
  out.push(row("ETA", s.eta?.label || null));
  if (s.heat) {
    const gpu = s.heat.gpu || {};
    const ram = s.heat.ram || {};
    out.push(row("GPU", gpu.utilPct != null ? `${gpu.utilPct}%` : null));
    out.push(row("GPU TEMP", gpu.tempC != null ? `${gpu.tempC}°C` : null));
    out.push(row("RAM", ram.pct != null ? `${ram.pct}%` : null));
  }
  if (s.blockedReason) out.push(row("REASON", s.blockedReason));
  if (s.lastError) out.push(row("LAST BITE", s.lastError));
  if (s.speech) out.push(row("SAYS", s.speech));
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
