/**
 * Production dispatch: the Mediator driving the real mission runner.
 *
 * Long-horizon autonomy comes from chaining small verified missions, not from
 * handing Robo Puppy one enormous job. Each supervisor TASK becomes its own
 * micro-mission with a narrow scope, runs through the existing runner (and
 * therefore the existing preflight, scope enforcement, critic, tutor, and
 * checkpoint machinery), and its real artifacts become the trusted evidence for
 * the next supervisor turn.
 *
 * Three hard safety properties:
 *   1. Construction requires explicit human authorization. The console cannot
 *      reach this class.
 *   2. A micro-mission's allowedPaths is the INTERSECTION of what the supervisor
 *      asked for and what the base spec permits. Scope can only narrow.
 *   3. Preserved (parked) files are hashed before and after every micro-mission.
 *      Any drift sets preservationHashMismatch, which the router treats as a
 *      safety-critical halt.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { classifyFailure } from "../mission/failureClass.mjs";
import { gitPorcelain } from "../mission/gitops.mjs";
import { loadMission } from "../mission/store.mjs";
import { matchesAny, parseMissionFile, toPosixRel, LEVELS } from "../mission/schema.mjs";
import { allocateMicroMissionCallBudget } from "../mission/callBudget.mjs";
import { missionsDataDir, missionsSpecDir, repoRoot } from "../paths.mjs";
import { runMission } from "../mission/runner.mjs";
import { DISPATCH_MISSION, MediatorSession } from "./session.mjs";
import { loadBaseline, protectedProductionFiles, verifyBaseline } from "./worktreeBaseline.mjs";

/** Files whose bytes must never change as a side effect of Mediator work. */
export const ALWAYS_PRESERVED = [
  "src/components/FireCommand/GatePanel.tsx",
  "src/components/FireCommand/MacroPanel.tsx",
  "src/components/FireCommand/ModuleEnableToggle.tsx",
];

export function sha256File(rel) {
  const abs = join(repoRoot, rel);
  if (!existsSync(abs)) return null;
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

export function hashPreserved(paths) {
  const out = {};
  for (const rel of paths) out[rel] = sha256File(rel);
  return out;
}

export function diffPreserved(before, after) {
  const changed = [];
  for (const rel of Object.keys(before)) {
    if (before[rel] !== after[rel]) changed.push(rel);
  }
  return changed;
}

/**
 * Narrow the supervisor's requested scope against the base spec.
 * Returns only paths the base spec already allows — never a widened set.
 */
export function intersectScope(requested, baseAllowed) {
  const req = (requested || []).map(toPosixRel).filter(Boolean);
  if (!req.length) return [...baseAllowed];
  const kept = req.filter((p) => matchesAny(p, baseAllowed) || baseAllowed.includes(p));
  return kept.length ? kept : [...baseAllowed];
}

function safeId(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/**
 * Acceptance criteria are passed through verbatim.
 *
 * An earlier version sanitized them here because `schema.mjs` validated the
 * prose `acceptance` field with a path validator, so an ellipsis read as
 * traversal. That root cause is fixed (`asProseArray` vs `asPathArray`), so the
 * Mediator no longer alters what the supervisor actually wrote.
 */
export function acceptanceForSpec(items) {
  return (items || []).map((a) => String(a ?? "").trim()).filter(Boolean);
}

/**
 * Build a micro-mission markdown file from a validated supervisor TASK.
 * The safety envelope (level, model, forbidden/read-only/preserve, validation)
 * always comes from the base spec, never from the supervisor.
 */
export function writeMicroMission({ base, result, id, adoptCheckpoint = null, humanBrief = "" }) {
  const allowedPaths = intersectScope(result.allowedPaths, base.allowedPaths);
  const front = {
    id,
    title: `Mediator micro-task: ${result.workerObjective}`.slice(0, 120),
    goal: result.workerObjective,
    level: base.level,
    model: base.model || undefined,
    allowedPaths,
    readOnlyPaths: base.readOnlyPaths,
    forbiddenPaths: [...new Set([...(base.forbiddenPaths || []), ...(result.forbiddenPaths || [])])],
    preserveDirtyPaths: [...new Set([...(base.preserveDirtyPaths || []), ...ALWAYS_PRESERVED])],
    adoptDirtyPaths: base.adoptDirtyPaths,
    acceptance: acceptanceForSpec(result.acceptance),
    validation: base.validation,
    maxPhases: 1,
    maxRetriesPerPhase: base.maxRetriesPerPhase,
    maxModelCalls: allocateMicroMissionCallBudget(
      result.recommendedModelCalls,
      base.maxModelCalls,
      { edits: Boolean(LEVELS[base.level]?.edits) },
    ),
    maxWallClockMs: base.maxWallClockMs,
    sessionTimeoutMs: base.sessionTimeoutMs,
    proposalRounds: 1,
    checkpointPolicy: base.checkpointPolicy,
    corpus: "if-stale",
    diff: base.diff,
  };
  if (adoptCheckpoint) front.adoptCheckpoint = adoptCheckpoint;
  for (const k of Object.keys(front)) if (front[k] === undefined) delete front[k];

  const body = `# One job

You are Robo Puppy.

${result.workerObjective}

## Acceptance
${(result.acceptance || []).map((a) => `- ${a}`).join("\n")}

## Scope
You may edit only:
${allowedPaths.map((p) => `- ${p}`).join("\n")}

Do not create new files. Do not touch anything else.

## Why this task exists
${humanBrief.slice(0, 1200)}
`;

  const text = `---\n${JSON.stringify(front, null, 2)}\n---\n\n${body}`;
  const out = join(missionsSpecDir, `${id}.md`);
  writeFileSync(out, text, "utf8");
  return { path: out, front, allowedPaths };
}

/** Read back everything the runner actually produced. All of it is trusted. */
export function harvestMission(missionId) {
  const dir = join(missionsDataDir, missionId);
  const read = (name) => {
    const p = join(dir, name);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  };
  let status = null;
  try {
    status = JSON.parse(read("status.json") || "null");
  } catch {
    status = null;
  }
  let validation = null;
  try {
    validation = JSON.parse(read("validation.json") || "null");
  } catch {
    validation = null;
  }
  let attribution = null;
  try {
    attribution = JSON.parse(read("attribution.json") || "null");
  } catch {
    attribution = null;
  }
  const journal = read("JOURNAL.md");
  return {
    dir,
    status,
    validation,
    attribution,
    journalTail: journal ? journal.split("\n").slice(-25).join("\n") : null,
    diffStat: read("total-diff.txt") || read("diff.patch"),
  };
}

export class MissionMediatorSession extends MediatorSession {
  constructor({ baseSpecPath, authorized = false, ...opts } = {}) {
    super({ ...opts, dispatch: DISPATCH_MISSION });
    if (authorized !== true) {
      throw new Error(
        "production mission dispatch requires explicit human authorization "
        + "(pass --authorize-production on the CLI); the console cannot start one",
      );
    }
    const parsed = parseMissionFile(baseSpecPath);
    if (!parsed.ok) throw new Error(`base mission spec is invalid: ${parsed.errors.join("; ")}`);
    this.spec = parsed.spec;
    this.baseSpecPath = baseSpecPath;
    this.microIndex = 0;
    this.lastMissionId = null;
    this.lastCheckpointRef = null;
    this.lastHarvest = null;
    this.lastFailureClass = null;
    this.sameFailureRun = 0;
    this.lastChangedFiles = [];
    this.lastByteDelta = null;
    // Preserved paths come from the spec, plus the parked Fire Command files
    // unconditionally, plus every production file the worktree baseline has
    // identified as carrying real (non-line-ending) parked work.
    const wt = loadBaseline();
    const parkedProduction = protectedProductionFiles(wt).map((f) => f.path);
    if (!wt) {
      this.log?.("warning: no worktree baseline captured. Run `mediator baseline capture` so parked work is protected by hash.");
    }
    this.worktreeBaseline = wt;
    this.preservedPaths = [...new Set([
      ...(parsed.spec.preserveDirtyPaths || []),
      ...ALWAYS_PRESERVED,
      ...parkedProduction,
    ])];
    this.preservedBaseline = hashPreserved(this.preservedPaths);
  }

  /**
   * DEEP just issued a bounded worker task. The next failure of the same class
   * is the first attempt under the new teaching packet, not continuation of the
   * pre-escalation streak that caused the gear change.
   */
  onEscalationResolved() {
    this.sameFailureRun = 0;
  }

  /** Real artifacts only. Nothing here is a model's account of what happened. */
  async gatherEvidence() {
    const items = [];
    const h = this.lastHarvest;

    if (!h) {
      items.push({
        kind: "CONTEXT_PACK",
        label: "mission scope from the authorized base spec",
        source: this.baseSpecPath,
        content: [
          `level: ${this.spec.level}`,
          `allowedPaths: ${this.spec.allowedPaths.join(", ")}`,
          `readOnlyPaths: ${(this.spec.readOnlyPaths || []).join(", ") || "(none)"}`,
          `forbiddenPaths: ${(this.spec.forbiddenPaths || []).join(", ") || "(none)"}`,
          `validation: ${(this.spec.validation?.required || []).join(", ") || "(none)"}`,
        ].join("\n"),
      });
      items.push({
        kind: "GIT_OUTPUT",
        label: "git status --porcelain before any Mediator task",
        source: "gitops.gitPorcelain",
        content: JSON.stringify(gitPorcelain(), null, 1),
      });
      return { family: "unknown", situationText: "No task has been attempted yet. Choose the first narrow objective.", items };
    }

    if (h.status) {
      items.push({
        kind: "RUNNER_EVIDENCE",
        label: `runner status for ${h.status.missionId}`,
        source: `${h.dir}/status.json`,
        content: [
          `state: ${h.status.state}`,
          `blockedReason: ${h.status.blockedReason || "(none)"}`,
          `failedReason: ${h.status.failedReason || "(none)"}`,
          `modelCalls: ${h.status.modelCalls}/${h.status.maxModelCalls ?? "?"}`,
          `emptyEdits: ${h.status.emptyEdits ?? 0}  syntaxFailures: ${h.status.syntaxFailures ?? 0}`,
          `readOnlyViolations: ${h.status.readOnlyViolations ?? 0}  automaticRestores: ${h.status.automaticRestores ?? 0}`,
        ].join("\n"),
      });
    }
    if (h.journalTail) {
      items.push({ kind: "RUNNER_EVIDENCE", label: "mission journal (tail)", source: `${h.dir}/JOURNAL.md`, content: h.journalTail });
    }
    if (h.validation) {
      items.push({ kind: "TEST_OUTPUT", label: "deterministic validation report", source: `${h.dir}/validation.json`, content: JSON.stringify(h.validation, null, 1).slice(0, 8000) });
    }
    items.push({
      kind: "HASH",
      label: "byte delta produced by the last task",
      source: "attribution fingerprints",
      content: `changedFiles=${(this.lastChangedFiles || []).length} files=[${(this.lastChangedFiles || []).join(", ")}] byteDelta=${this.lastByteDelta ?? "unknown"}`,
    });
    items.push({
      kind: "GIT_OUTPUT",
      label: "git status --porcelain after the last task",
      source: "gitops.gitPorcelain",
      content: JSON.stringify(gitPorcelain(), null, 1),
    });
    if (h.diffStat) {
      items.push({ kind: "GIT_OUTPUT", label: "diff produced by the last task", source: `${h.dir}`, content: String(h.diffStat).slice(0, 8000) });
    }

    const family = this.lastFailureClass === "APPLY_EMPTY" ? "empty_edit"
      : this.lastFailureClass === "SCOPE_VIOLATION" ? "scope_discipline"
        : "typescript_microfix";

    return {
      family,
      situationText: `The previous micro-mission ${this.lastMissionId} ended in ${h.status?.state || "an unknown state"}. Review it and decide what happens next.`,
      items,
    };
  }

  async runWorker(result, { taskId }) {
    this.microIndex += 1;
    const id = safeId(`${this.spec.id}-m${String(this.microIndex).padStart(2, "0")}`);
    const written = writeMicroMission({
      base: this.spec,
      result,
      id,
      adoptCheckpoint: this.lastCheckpointRef,
      humanBrief: this.humanBrief,
    });
    this.emit({ kind: "NOTE", note: `micro-mission ${id} written; scope narrowed to ${written.allowedPaths.join(", ")}` });

    const before = hashPreserved(this.preservedPaths);
    const startedAt = Date.now();
    let status = null;
    let error = null;
    try {
      status = await runMission({ specPath: written.path, log: this.log });
    } catch (err) {
      error = String(err?.message || err);
    }
    const after = hashPreserved(this.preservedPaths);
    const drifted = diffPreserved(before, after);

    // Hashing the preserved set catches targeted damage. Verifying the whole
    // baseline also catches a wholesale snapshot restore, which is how parked
    // work was silently lost once already.
    let worktree = null;
    if (this.worktreeBaseline) {
      worktree = verifyBaseline(this.worktreeBaseline);
      if (!worktree.safe) {
        this.emit({
          kind: "PROVIDER_FAILURE",
          error: `parked work lost: ${worktree.lostSemantic.map((f) => f.path).join(", ")}`,
        });
      }
    }

    this.lastMissionId = id;
    const harvest = harvestMission(id);
    this.lastHarvest = harvest;
    this.missionId = id;

    const changedFiles = (harvest.attribution?.total?.changed || []).map((c) => c.path || c) || [];
    this.lastChangedFiles = changedFiles;
    this.lastByteDelta = changedFiles.length;

    const validationOk = harvest.validation
      ? Object.values(harvest.validation).every((v) => v?.ok !== false)
      : null;

    const classification = classifyFailure({
      state: status?.state,
      emptyEdit: changedFiles.length === 0 && status?.state !== "COMPLETE",
      validationFailed: validationOk === false,
      blockedReason: status?.blockedReason || error,
    }) || {};
    const failureClass = classification.failureClass || null;

    // "Same worker failure twice" is a routing trigger, so it has to be counted
    // across micro-missions rather than inferred inside one.
    if (failureClass && failureClass === this.lastFailureClass) this.sameFailureRun += 1;
    else this.sameFailureRun = failureClass ? 1 : 0;
    this.lastFailureClass = failureClass;

    if (harvest.status?.checkpoints?.length) {
      const n = harvest.status.checkpoints.length;
      this.lastCheckpointRef = `${id}/checkpoints/${String(n).padStart(2, "0")}`;
    }

    // Preservation drift is the one thing that stops everything immediately.
    if (drifted.length) {
      this.emit({ kind: "PROVIDER_FAILURE", error: `preserved files changed: ${drifted.join(", ")}` });
    }

    return {
      summary: error
        ? `runner threw: ${error}`
        : `micro-mission ${id} ended ${status?.state}; ${changedFiles.length} file(s) changed`,
      // A thrown runner is an infrastructure failure, not a worker outcome. It
      // must never be absorbed into a normal result and read as progress.
      infrastructureFailure: Boolean(error),
      error,
      byteDelta: this.lastByteDelta,
      changedFiles,
      workerCalls: harvest.status?.modelCalls ?? null,
      failureClass: this.lastFailureClass,
      outcome: status?.state === "COMPLETE" ? "KEEP" : "RETRY",
      checkpointDecision: this.lastCheckpointRef ? "PRESERVE" : "NONE",
      validation: harvest.validation,
      validationMs: null,
      family: "typescript_microfix",
      implementedBy: "ROBO_PUPPY",
      workerLatencyMs: Date.now() - startedAt,
      situation: {
        preservationHashMismatch: drifted.length > 0 || (worktree ? !worktree.safe : false),
        sameFailureCount: this.sameFailureRun,
      },
    };
  }
}
