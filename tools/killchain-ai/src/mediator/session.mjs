/**
 * The autonomous training loop.
 *
 * brief -> evidence -> route -> supervisor -> tiny task -> worker ->
 * deterministic validation -> review -> keep / retry / revert / escalate / stop
 *
 * Long-horizon autonomy comes from chaining small verified tasks, not from
 * handing the local worker one enormous job. Nothing in this file decides
 * whether work is good; it decides who gets asked, and it records what happened.
 */
import { randomUUID } from "node:crypto";

import {
  MODE_AUTO,
  ROUTE_DEEP,
  ROUTE_FAST,
  ROUTE_HUMAN,
  ROUTE_VISUAL,
  describeRoute,
  nextSituationAfterResolution,
  routeSupervisor,
  situationFromResult,
} from "./router.mjs";
import { appendEvent, loadRunState, readEvents, saveRunState } from "./eventLog.mjs";
import { askSupervisor, buildSupervisorPrompt, supervisorTimeoutMs } from "./supervisorInvoker.mjs";
import { loadRegistry, recordCall, roleModel, saveRegistry } from "./modelRegistry.mjs";
import { memorySummary, recordTask } from "./trainingMemory.mjs";
import { recommendedTeachingLevel } from "./skillProfile.mjs";
import { addEvidence, createEvidencePack, packSummary } from "./trust.mjs";

export const RUN_STATES = ["IDLE", "RUNNING", "PAUSING", "PAUSED", "STOPPING", "STOPPED", "BLOCKED", "COMPLETE", "FAILED"];

/** Dispatch modes. `fixture` never touches production and needs no authorization. */
export const DISPATCH_FIXTURE = "fixture";
export const DISPATCH_MISSION = "mission";

/**
 * Live, in-process controller for one Mediator run.
 * All mutating control surfaces are methods so the HTTP layer stays thin.
 */
export class MediatorSession {
  constructor({
    brief,
    mode = MODE_AUTO,
    dispatch = DISPATCH_FIXTURE,
    maxTasks = 12,
    // Hard ceiling on provider calls. A supervision loop must never be able to
    // spend an unbounded number of model calls, however it misbehaves.
    maxSupervisorCalls = 40,
    // Consecutive review-only turns (KEEP/REVERT with no new task) that produce
    // no forward motion before we conclude there is nothing left to attempt.
    maxIdleReviews = 2,
    log = () => {},
    // Injectable for tests, matching the runner's `deps` convention.
    ask = askSupervisor,
    // Registry access is injectable so tests never write stub latencies into
    // the real observed-metrics file. Fake calls must not become telemetry.
    registry = { load: loadRegistry, save: saveRegistry },
  } = {}) {
    this.runId = `run_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
    // Store the original brief exactly. The operational objective is derived
    // from it; it never overwrites it.
    this.humanBrief = String(brief ?? "");
    this.operationalObjective = null;
    this.mode = mode;
    this.dispatch = dispatch;
    this.maxTasks = maxTasks;
    this.maxSupervisorCalls = maxSupervisorCalls;
    this.maxIdleReviews = maxIdleReviews;
    this.supervisorCalls = 0;
    this.idleReviews = 0;
    this.log = log;
    this.ask = ask;
    this.registry = registry;

    this.state = "IDLE";
    this.situation = {};
    this.currentGear = ROUTE_FAST;
    this.taskCount = 0;
    this.escalationCount = 0;
    this.lastDecision = null;
    this.lastRoute = null;
    this.dispatchedAt = null;
    this.missionId = null;
    this.workerBusy = false;
    this.awaitingDeep = false;
    this.providerError = null;
    this.blockedReason = null;
    this.startedAt = null;
    this.endedAt = null;
    this.timings = { routingMs: 0, supervisorMs: 0, workerMs: 0, validationMs: 0 };

    this.pauseRequested = false;
    this.stopRequested = false;
    this.escalateNowRequested = false;
    this.abort = new AbortController();
    this._running = null;
    this.deepUnavailable = false;
    this.deepTimeouts = 0;
  }

  /** Override in production dispatch to reset worker-failure streaks. */
  onEscalationResolved() {}

  emit(event) {
    const row = appendEvent(this.runId, event);
    return row;
  }

  snapshot() {
    return {
      runId: this.runId,
      state: this.state,
      mode: this.mode,
      dispatch: this.dispatch,
      humanBrief: this.humanBrief,
      operationalObjective: this.operationalObjective,
      currentGear: this.currentGear,
      taskCount: this.taskCount,
      maxTasks: this.maxTasks,
      supervisorCalls: this.supervisorCalls,
      maxSupervisorCalls: this.maxSupervisorCalls,
      idleReviews: this.idleReviews,
      escalationCount: this.escalationCount,
      lastDecision: this.lastDecision,
      lastRoute: this.lastRoute,
      dispatchedAt: this.dispatchedAt,
      missionId: this.missionId,
      workerBusy: this.workerBusy,
      awaitingDeep: this.awaitingDeep,
      providerError: this.providerError,
      blockedReason: this.blockedReason,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      timings: this.timings,
      pauseRequested: this.pauseRequested,
      stopRequested: this.stopRequested,
    };
  }

  persist() {
    saveRunState(this.runId, this.snapshot());
  }

  setMode(mode) {
    this.mode = mode;
    this.emit({ kind: "NOTE", note: `routing mode set to ${mode}` });
    this.persist();
  }

  escalateNow() {
    this.escalateNowRequested = true;
    this.emit({ kind: "NOTE", note: "human requested immediate escalation" });
  }

  pauseAfterCurrentTask() {
    this.pauseRequested = true;
    if (this.state === "RUNNING") this.state = "PAUSING";
    this.emit({ kind: "NOTE", note: "pause requested; will stop after the current task" });
    this.persist();
  }

  resume() {
    if (this.state !== "PAUSED") return false;
    this.pauseRequested = false;
    this.state = "RUNNING";
    this.emit({ kind: "NOTE", note: "resumed by human" });
    this.persist();
    this._running = this._loop();
    return true;
  }

  /**
   * Safe stop: launch no new model work, let deterministic validation finish if
   * it is practical, keep the last known-good checkpoint, record state, and kill
   * child processes cleanly.
   */
  stopSafely({ cancelInFlight = false } = {}) {
    this.stopRequested = true;
    if (this.state === "RUNNING" || this.state === "PAUSING") this.state = "STOPPING";
    this.emit({ kind: "NOTE", note: `safe stop requested (cancelInFlight=${cancelInFlight})` });
    // Only abort a live child if the human explicitly asked for it. The default
    // is to let the current deterministic step finish.
    if (cancelInFlight) this.abort.abort();
    this.persist();
  }

  async start() {
    if (this._running) return this._running;
    this.state = "RUNNING";
    this.startedAt = Date.now();
    this.emit({ kind: "RUN_STARTED", runId: this.runId, mode: this.mode, dispatch: this.dispatch });
    this.emit({ kind: "BRIEF_RECEIVED", chars: this.humanBrief.length });
    this.persist();
    this._running = this._loop();
    return this._running;
  }

  /** Build the trusted evidence pack for this turn. Only real artifacts. */
  buildPack(extraEvidence = []) {
    const pack = createEvidencePack({ missionId: this.missionId, note: `${this.runId} task ${this.taskCount + 1}` });
    addEvidence(pack, {
      kind: "HUMAN_BRIEF",
      label: "original human/ChatGPT brief",
      source: "mediator console",
      content: this.humanBrief,
    });
    const history = memorySummary({ includeSimulated: this.dispatch === DISPATCH_FIXTURE });
    if (history && history !== "(no training history yet)") {
      addEvidence(pack, {
        kind: "RUNNER_EVIDENCE",
        label: "Robo Puppy training history summary",
        source: "trainingMemory.memorySummary",
        content: history,
      });
    }
    for (const e of extraEvidence) addEvidence(pack, e);
    return pack;
  }

  async _loop() {
    const reg = this.registry.load();
    try {
      while (this.taskCount < this.maxTasks) {
        if (this.stopRequested) {
          this.state = "STOPPED";
          this.emit({ kind: "STOPPED", reason: "safe stop", tasksCompleted: this.taskCount });
          break;
        }
        if (this.pauseRequested) {
          this.state = "PAUSED";
          this.emit({ kind: "PAUSED", tasksCompleted: this.taskCount });
          this.persist();
          return this.snapshot();
        }
        if (this.supervisorCalls >= this.maxSupervisorCalls) {
          this.state = "BLOCKED";
          this.blockedReason = `supervisor call budget exhausted (${this.maxSupervisorCalls}) after ${this.taskCount} task(s)`;
          this.emit({ kind: "STOPPED", reason: this.blockedReason, needsHuman: true });
          break;
        }

        // ---- route -------------------------------------------------------
        const routeStart = Date.now();
        const situation = this.escalateNowRequested
          ? { ...this.situation, fastRequestsEscalation: true }
          : this.situation;
        const availability = {
          [ROUTE_FAST]: Boolean(roleModel(reg, ROUTE_FAST)),
          [ROUTE_DEEP]: Boolean(roleModel(reg, ROUTE_DEEP)) && !this.deepUnavailable,
          [ROUTE_VISUAL]: Boolean(roleModel(reg, ROUTE_VISUAL)),
        };
        const route = routeSupervisor(situation, { mode: this.mode, availability });
        this.timings.routingMs += Date.now() - routeStart;
        this.escalateNowRequested = false;
        this.lastRoute = route;

        if (route.role !== this.currentGear && route.role !== ROUTE_HUMAN) {
          this.emit({ kind: "GEAR_CHANGE", from: this.currentGear, to: route.role, reason: route.reason });
          this.currentGear = route.role;
        }
        this.emit({ kind: "ROUTE", role: route.role, ruleId: route.ruleId, reason: route.reason, safetyCritical: route.safetyCritical, degraded: route.degraded, overridden: route.overridden });
        this.log(`  route: ${describeRoute(route)}`);

        if (route.role === ROUTE_HUMAN || route.stop) {
          this.state = "BLOCKED";
          this.blockedReason = route.reason;
          this.emit({ kind: "STOPPED", reason: route.reason, needsHuman: true });
          break;
        }
        this.awaitingDeep = route.role === ROUTE_DEEP;
        if (route.role === ROUTE_DEEP) this.escalationCount += 1;

        const model = roleModel(reg, route.role);
        if (!model) {
          this.state = "BLOCKED";
          this.blockedReason = `no model assigned to ${route.role}`;
          this.emit({ kind: "PROVIDER_FAILURE", error: this.blockedReason });
          break;
        }

        // ---- supervise ---------------------------------------------------
        const evidence = await this.gatherEvidence();
        const pack = this.buildPack(evidence.items || []);
        const teaching = recommendedTeachingLevel(evidence.family || "unknown", { includeSimulated: this.dispatch === DISPATCH_FIXTURE });
        const prompt = buildSupervisorPrompt({
          role: route.role,
          humanBrief: this.humanBrief,
          operationalObjective: this.operationalObjective,
          situation: evidence.situationText || "Decide the next step.",
          pack,
          spec: this.spec || null,
          extra: `TEACHING GUIDANCE\nHistorically sufficient teaching level for this task family: ${teaching.level} (${teaching.reason}).\nGive the least help that has previously worked. The goal is a more independent worker.`,
        });

        const supStart = Date.now();
        const outcome = await this.ask({
          role: route.role,
          model,
          prompt,
          pack,
          spec: this.spec || null,
          signal: this.abort.signal,
          title: `kc-mediator-${this.runId}`,
          timeoutMs: supervisorTimeoutMs(route.role),
          log: this.log,
        });
        const supMs = Date.now() - supStart;
        this.timings.supervisorMs += supMs;

        this.supervisorCalls += outcome.calls.length;
        for (const call of outcome.calls) {
          recordCall(reg, model, {
            ok: call.ok,
            durationMs: call.durationMs,
            timedOut: call.timedOut,
            structuredAttempt: true,
            structuredValid: outcome.ok,
            error: call.error,
          });
          this.emit({ kind: "SUPERVISOR_CALL", role: route.role, model, callId: call.callId, durationMs: call.durationMs, ok: call.ok, error: call.error, tokens: call.tokens || null });
        }
        this.registry.save(reg);

        if (!outcome.ok) {
          this.providerError = outcome.reason;
          const timedOut = Boolean(outcome.calls?.some((c) => c.timedOut) || outcome.reason === "timeout");
          this.emit({ kind: "PROVIDER_FAILURE", model, error: outcome.reason, timedOut, role: route.role });
          if (timedOut && route.role === ROUTE_DEEP) {
            this.deepTimeouts += 1;
            this.deepUnavailable = true;
            this.emit({
              kind: "DEEP_TIMEOUT",
              safetyCritical: Boolean(route.safetyCritical),
              reason: route.reason,
            });
            if (route.safetyCritical) {
              this.state = "BLOCKED";
              this.blockedReason = `DEEP_TIMEOUT: safety-critical decision cannot fall back (${route.reason})`;
              this.emit({ kind: "STOPPED", reason: this.blockedReason, needsHuman: true });
              break;
            }
            this.log("DEEP supervisor timed out; marking DEEP unavailable and continuing on FAST for non-safety work");
            continue;
          }
          // A supervisor we cannot parse is not a decision. Escalate once, then stop.
          if (route.role === ROUTE_FAST && availability[ROUTE_DEEP]) {
            this.situation = { ...this.situation, fastRequestsEscalation: true };
            continue;
          }
          this.state = "BLOCKED";
          this.blockedReason = outcome.reason;
          break;
        }
        this.providerError = null;

        const result = outcome.result;
        this.lastDecision = result.decision;
        this.emit({
          kind: "SUPERVISOR_DECISION",
          role: route.role,
          model,
          decision: result.decision,
          reason: result.reason,
          confidence: result.confidence,
          teachingLevel: result.teachingLevel,
          evidenceRefs: result.trustedEvidenceRefs,
          latencyMs: supMs,
        });

        // A resolved deep escalation drops the router back to FAST rather than
        // leaving the slow model switched on.
        if (route.role === ROUTE_DEEP && ["TASK", "KEEP", "RETRY", "REVERT"].includes(result.decision)) {
          this.situation = nextSituationAfterResolution(this.situation);
          this.onEscalationResolved();
          this.emit({ kind: "ESCALATION_RESOLVED", reason: result.reason });
        } else {
          this.situation = situationFromResult(this.situation, result, { role: route.role });
        }

        if (["STOP", "NEEDS_SENIOR_IMPLEMENTATION"].includes(result.decision)) {
          this.state = result.decision === "STOP" ? "BLOCKED" : "BLOCKED";
          this.blockedReason = `${result.decision}: ${result.reason}`;
          this.emit({ kind: "STOPPED", reason: this.blockedReason, needsHuman: true });
          break;
        }
        if (result.decision === "ESCALATE") {
          this.situation = { ...this.situation, fastRequestsEscalation: true };
          this.emit({ kind: "ESCALATION", reason: result.escalationReason || result.reason });
          continue;
        }
        if (!["TASK", "RETRY"].includes(result.decision)) {
          // KEEP / REVERT are reviews of prior work, not new tasks. They advance
          // nothing on their own, so repeating one means the loop has settled.
          this.situation = { ...this.situation, lastReview: result.decision };
          this.idleReviews += 1;
          this.emit({ kind: "NOTE", note: `review recorded: ${result.decision} (no new task; idle review ${this.idleReviews}/${this.maxIdleReviews})` });
          if (this.taskCount === 0 || this.idleReviews >= this.maxIdleReviews) {
            this.state = "COMPLETE";
            this.emit({
              kind: "RUN_FINISHED",
              tasksCompleted: this.taskCount,
              reason: `supervisor returned ${result.decision} with no further task to attempt`,
            });
            break;
          }
          continue;
        }
        this.idleReviews = 0;

        // ---- dispatch to the worker --------------------------------------
        if (this.stopRequested) {
          this.state = "STOPPED";
          this.emit({ kind: "STOPPED", reason: "safe stop before dispatch", tasksCompleted: this.taskCount });
          break;
        }

        this.operationalObjective = result.workerObjective;
        this.dispatchedAt = Date.now();
        this.taskCount += 1;
        const taskId = `${this.runId}#${this.taskCount}`;
        this.emit({ kind: "TASK_DISPATCHED", taskId, workerObjective: result.workerObjective, acceptance: result.acceptance, allowedPaths: result.allowedPaths, teachingLevel: result.teachingLevel });

        const workStart = Date.now();
        this.workerBusy = true;
        let workerResult;
        try {
          workerResult = await this.runWorker(result, { taskId });
        } finally {
          this.workerBusy = false;
        }
        const workerMs = Date.now() - workStart;
        this.timings.workerMs += workerMs;
        this.timings.validationMs += workerResult.validationMs || 0;

        this.emit({ kind: "WORKER_RESULT", taskId, summary: workerResult.summary, byteDelta: workerResult.byteDelta, failureClass: workerResult.failureClass, durationMs: workerMs });
        if (workerResult.validation) {
          this.emit({ kind: "VALIDATION", taskId, ...workerResult.validation });
        }
        if (workerResult.infrastructureFailure) {
          this.state = "FAILED";
          this.blockedReason = `infrastructure failure: ${workerResult.error || workerResult.summary}`;
          this.emit({ kind: "PROVIDER_FAILURE", taskId, error: this.blockedReason });
          this.persist();
          break;
        }

        recordTask({
          taskId,
          runId: this.runId,
          family: workerResult.family || evidence.family || "unknown",
          humanObjective: this.humanBrief.slice(0, 500),
          supervisorModel: model,
          supervisorRole: route.role,
          routingRuleId: route.ruleId,
          evidenceRefs: result.trustedEvidenceRefs,
          evidenceBytes: pack.items.reduce((a, i) => a + i.bytes, 0),
          workerObjective: result.workerObjective,
          workerModel: roleModel(reg, "ROBO_PUPPY"),
          allowedPaths: result.allowedPaths,
          teachingLevel: result.teachingLevel,
          workerCalls: workerResult.workerCalls,
          byteDelta: workerResult.byteDelta,
          changedFiles: workerResult.changedFiles,
          validation: workerResult.validation,
          diagnosticBefore: workerResult.diagnosticBefore,
          diagnosticAfter: workerResult.diagnosticAfter,
          failureClass: workerResult.failureClass,
          retry: result.decision === "RETRY",
          checkpointDecision: workerResult.checkpointDecision,
          outcome: workerResult.outcome,
          implementedBy: workerResult.implementedBy || "ROBO_PUPPY",
          supervisorLatencyMs: supMs,
          workerLatencyMs: workerMs,
          validationLatencyMs: workerResult.validationMs || null,
          escalationCount: this.escalationCount,
          simulated: this.dispatch === DISPATCH_FIXTURE,
        });

        this.situation = { ...this.situation, ...(workerResult.situation || {}) };
        this.persist();
      }

      if (this.state === "RUNNING") {
        // Reaching the task budget is not the same as finishing the work.
        const budgetReached = this.taskCount >= this.maxTasks;
        this.state = "COMPLETE";
        this.emit({
          kind: "RUN_FINISHED",
          tasksCompleted: this.taskCount,
          reason: budgetReached
            ? `task budget reached (${this.maxTasks}); more work may remain`
            : "no further task to attempt",
          budgetReached,
        });
      }
    } catch (err) {
      this.state = "FAILED";
      this.blockedReason = String(err?.message || err);
      this.emit({ kind: "PROVIDER_FAILURE", error: this.blockedReason });
    } finally {
      this.endedAt = Date.now();
      this._running = null;
      this.persist();
    }
    return this.snapshot();
  }

  /** Overridden by the dispatch strategy. Base returns no extra evidence. */
  async gatherEvidence() {
    return { family: "unknown", situationText: "No situation adapter is bound.", items: [] };
  }

  async runWorker() {
    throw new Error("no worker dispatcher bound");
  }
}

export function loadRun(runId) {
  const state = loadRunState(runId);
  if (!state) return null;
  return { state, events: readEvents(runId) };
}

export { packSummary };
