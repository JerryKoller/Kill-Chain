/**
 * Robo Puppy's visual state.
 *
 * This is a presentation layer over the existing canonical status, not a second
 * source of truth. `puppyStatus()` in src/puppy/status.mjs already maps the
 * runner's 15 machine states onto 11 canonical display states; we map those onto
 * the animation states the console needs, and add only distinctions that
 * correspond to something real.
 *
 * The hard rule: never show WORKING when nothing is happening. SLEEPING is what
 * genuine idleness looks like, and it is derived from the absence of a live
 * mission — not from a timer or a decorative animation loop.
 */
import { puppyStatus } from "../puppy/status.mjs";

export const VISUAL_STATES = [
  "SLEEPING",
  "WAKING",
  "READING",
  "PLANNING",
  "THINKING",
  "WORKING",
  "VALIDATING",
  "REPAIRING",
  "REVERTING",
  "CONFUSED",
  "HAPPY",
  "WAITING_FOR_TEACHER",
  "BLOCKED",
  "ERROR",
];

/**
 * How long after a dispatch we are willing to call it "waking".
 * Past this, if the runner still is not working, something is wrong and we stop
 * showing a friendly transitional animation.
 */
export const WAKE_WINDOW_MS = 20000;

/** Lines are keyed to real conditions. Personality never overrides truth. */
const VISUAL_MOOD = {
  SLEEPING: "Dreaming about semicolons.",
  WAKING: "Ears up. Something's happening.",
  READING: "Nose down, reading the code.",
  PLANNING: "Working out where to dig.",
  THINKING: "Trying to prove himself wrong.",
  WORKING: "Chewing on the task.",
  VALIDATING: "Waiting to see if the compiler approves.",
  REPAIRING: "Fixing his own mess.",
  REVERTING: "Putting the furniture back.",
  CONFUSED: "Tilting his head at the error message.",
  HAPPY: "Good puppy. Build passed.",
  WAITING_FOR_TEACHER: "Waiting for the grown-up model.",
  BLOCKED: "Stopped on purpose. Needs a human.",
  ERROR: "Something broke that wasn't his fault.",
};

/**
 * Derive the visual state.
 *
 * @param {object} status  result of puppyStatus()
 * @param {object} hints   real Mediator facts: when a task was dispatched, the
 *                         last supervisor decision, and any live provider error
 */
export function visualPuppyState(status, hints = {}) {
  const canonical = status?.state || "IDLE";
  const now = hints.now || Date.now();
  const decision = hints.lastDecision || null;

  const pick = (visual, why) => ({ visual, canonical, why });

  // With no live Mediator run, the last mission's terminal state is history, not
  // current activity. Showing it would report a stale BLOCKED as if it were now.
  if (hints.noActiveRun && !status?.working) {
    return hints.lastRunCompleted
      ? pick("HAPPY", "the last run completed; nothing is running now")
      : pick("SLEEPING", "no Mediator run is active");
  }

  // A run with no bound mission (fixture dispatch) must be driven by the
  // Mediator's own dispatch state. puppyStatus() otherwise falls back to the
  // most recent mission on disk, which would report an unrelated old run's
  // phase as if it were what the worker is doing right now.
  if (hints.missionBound === false) {
    if (hints.providerError) return { visual: "ERROR", canonical: "IDLE", why: "a provider call failed" };
    if (hints.runBlocked) return { visual: "BLOCKED", canonical: "IDLE", why: hints.runBlocked };
    if (hints.workerBusy) {
      return decision === "RETRY"
        ? { visual: "REPAIRING", canonical: "EDITING", why: "reworking the task after a bounded retry" }
        : { visual: "WORKING", canonical: "EDITING", why: "the worker is executing a dispatched task" };
    }
    if (hints.awaitingDeep) {
      return { visual: "WAITING_FOR_TEACHER", canonical: "IDLE", why: "the Mediator escalated to the deep supervisor" };
    }
    const since = Number(hints.dispatchedAt || 0);
    if (since && now - since < WAKE_WINDOW_MS) {
      return { visual: "WAKING", canonical: "IDLE", why: "a task was just dispatched" };
    }
    if (hints.lastRunCompleted) return { visual: "HAPPY", canonical: "IDLE", why: "the run completed" };
    return { visual: "SLEEPING", canonical: "IDLE", why: "no task assigned; the Mediator is deciding what to attempt" };
  }

  if (hints.providerError || status?.lastError) {
    return pick("ERROR", hints.providerError ? "a provider or process call failed" : "the runner recorded an error");
  }
  if (canonical === "BLOCKED") return pick("BLOCKED", status?.blockedReason || "runner blocked");
  if (canonical === "WAITING_FOR_TEACHER") return pick("WAITING_FOR_TEACHER", "a teacher packet is pending");
  if (canonical === "COMPLETE") return pick("HAPPY", "mission completed");
  if (canonical === "CHECKPOINTING") return pick("HAPPY", "a checkpoint is being written");

  if (canonical === "REPAIRING") {
    if (decision === "REVERT") return pick("REVERTING", "the supervisor rejected the candidate");
    if (decision === "RETRY") return pick("CONFUSED", "a bounded retry was requested");
    return pick("REPAIRING", "runner is repairing");
  }
  if (decision === "REVERT" && hints.revertInProgress) {
    return pick("REVERTING", "a checkpoint restore is in progress");
  }

  if (canonical === "VALIDATING") return pick("VALIDATING", "compiler or tests are running");
  if (canonical === "EDITING") return pick("WORKING", "the worker is editing files");
  if (canonical === "CRITIQUING") return pick("THINKING", "a model is generating a review");
  if (canonical === "PLANNING") return pick("PLANNING", "the worker is planning");
  if (canonical === "INVESTIGATING") return pick("READING", "the worker is gathering evidence");

  // Idle. The only question left is whether he is asleep or just waking up.
  const dispatchedAt = Number(hints.dispatchedAt || 0);
  if (dispatchedAt && now - dispatchedAt < WAKE_WINDOW_MS && !status?.finished) {
    return pick("WAKING", "a task was just dispatched");
  }
  return pick("SLEEPING", status?.missionId ? "no active phase" : "no mission assigned");
}

/**
 * Full Puppy panel payload.
 *
 * Prefers the existing `barkLine()` speech because it encodes real counters
 * (empty edits, restores, leash yanks). The visual-state line is only a
 * fallback so a new state is never silently blank.
 */
export function puppyPanel({ missionId = null, hints = {} } = {}) {
  const status = puppyStatus({ missionId });
  const derived = visualPuppyState(status, hints);

  // An unbound run has no mission on disk. puppyStatus() falls back to whatever
  // mission ran last, so none of its detail describes what is happening now.
  const unbound = hints.missionBound === false;
  // barkLine() encodes real counters and is preferred — but only when it belongs
  // to the state we are actually showing. A stale line would be a small lie.
  const barkMatchesState = !unbound && (!hints.noActiveRun || status.working);
  // With no live run, any mission detail on disk is history. Flagging it lets the
  // console label it as such instead of presenting it as current activity.
  const historical = !unbound && Boolean(hints.noActiveRun) && !status.working;

  return {
    ...status,
    missionId: unbound ? null : status.missionId,
    counters: unbound ? {} : status.counters,
    lastError: unbound ? null : status.lastError,
    finished: unbound ? Boolean(hints.lastRunCompleted) : status.finished,
    working: unbound ? Boolean(hints.workerBusy) : status.working,
    visualState: derived.visual,
    visualReason: derived.why,
    canonicalState: unbound ? null : derived.canonical,
    speech: (barkMatchesState && status.speech) || VISUAL_MOOD[derived.visual] || "",
    visualMood: VISUAL_MOOD[derived.visual] || "",
    asleep: derived.visual === "SLEEPING",
    unbound,
    historical,
    lastMission: historical && status.missionId
      ? { missionId: status.missionId, state: status.state }
      : null,
  };
}

export { VISUAL_MOOD };
