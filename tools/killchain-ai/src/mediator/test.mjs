/**
 * Deterministic Mediator tests.
 *
 * Matches the existing tooling convention: a hand-rolled ok()/check() harness,
 * no test framework, run via `mediator test`.
 *
 * Nothing here needs a provider, a mission, or production access.
 */
import { HISTORICAL_FIXTURES, BENCHMARK_CASES, packForFixture } from "./fixtures.mjs";
import {
  MODE_AUTO,
  MODE_DEEP_ONLY,
  MODE_FAST_ONLY,
  ROUTE_DEEP,
  ROUTE_FAST,
  ROUTE_HUMAN,
  ROUTE_VISUAL,
  applyAvailability,
  nextSituationAfterResolution,
  routeSupervisor,
} from "./router.mjs";
import {
  DECISIONS,
  extractJsonObject,
  validateSupervisorResult,
} from "./supervisorProtocol.mjs";
import {
  UNTRUSTED_KINDS,
  addEvidence,
  createEvidencePack,
  groundsClaim,
  resolveRefs,
} from "./trust.mjs";
import { resolve, join } from "node:path";
import { existsSync, readFileSync, unlinkSync } from "node:fs";

import { repoRoot } from "../paths.mjs";
import { parseMissionMarkdown } from "../mission/schema.mjs";
import {
  askSupervisor,
  assertNotInGitRepo,
  invokeSupervisor,
  parseSupervisorStream,
  supervisorRunArgs,
  supervisorSandbox,
  supervisorTimeoutMs,
  SUPERVISOR_TIMEOUT_MS,
} from "./supervisorInvoker.mjs";
import { PUPPY_ACCENT, contrastRatio, sanitizeColor, sanitizeText, validateIdentity } from "./identity.mjs";
import { VISUAL_MOOD, VISUAL_STATES, puppyPanel, visualPuppyState } from "./puppyState.mjs";
import { chooseShapeFamily, renderAvatarSvg } from "./avatar.mjs";
import { MEDIATOR_PORT, MEDIATOR_PORT_FALLBACKS, pickPort } from "./server.mjs";
import { PRISM_ORIGIN, PRISM_PORT, prismChromeProfile } from "./launch.mjs";
import { WATCH_PORT, WATCH_PORT_SCAN } from "../puppy/watch.mjs";
import { PORT_SCAN as HARNESS_PORT_SCAN } from "../ui/captureHarness.mjs";
import { inventedPaths, scoreCase } from "./benchmark.mjs";
import { normalizeFamily } from "./trainingMemory.mjs";
import { MediatorSession } from "./session.mjs";
import {
  ALWAYS_PRESERVED,
  MissionMediatorSession,
  diffPreserved,
  hashPreserved,
  intersectScope,
  acceptanceForSpec,
  writeMicroMission,
} from "./missionSession.mjs";
import { FIELD_RUN_MTO1HFMY } from "./fieldRunMto1hfmy.mjs";
import { allocateMicroMissionCallBudget } from "../mission/callBudget.mjs";
import {
  captureBaseline,
  eolProfile,
  protectedProductionFiles,
  verifyBaseline,
} from "./worktreeBaseline.mjs";
import { parseVerboseModels, roleEligibility } from "./modelDiscovery.mjs";

function ok(name, cond, detail = "", log = console.log) {
  if (cond) {
    log(`PASS  ${name}`);
    return true;
  }
  log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  return false;
}

const GOOD_THEME = {
  primary: "#6b3fa0", secondary: "#c7a0e8", background: "#0d0814",
  surface: "#1a1226", text: "#f0e8fa", warning: "#f5a623", success: "#3dffb0",
};

function validResult(over = {}) {
  return JSON.stringify({
    decision: "TASK",
    reason: "The compiler diagnostic moved to a new identifier family and needs one narrow fix.",
    workerObjective: "Declare the missing `ro` variable in the scene shader.",
    acceptance: ["shader compiles", "no new diagnostics"],
    trustedEvidenceRefs: ["E1"],
    allowedPaths: ["src/components/Visualizer/singularity.ts"],
    forbiddenPaths: [],
    recommendedModelCalls: 6,
    confidence: 0.82,
    teachingLevel: 1,
    escalationReason: null,
    ...over,
  });
}

function packWith(content = "ERROR: 0:61: 'ro' : undeclared identifier") {
  const pack = createEvidencePack({});
  addEvidence(pack, { kind: "COMPILER_OUTPUT", label: "log", content });
  return pack;
}

export async function runMediatorTests({ log = console.log } = {}) {
  let passed = 0;
  let failed = 0;
  const check = (name, cond, detail) => {
    if (ok(name, cond, detail, log)) passed += 1;
    else failed += 1;
  };
  const section = (s) => log(`\n── ${s} ${"─".repeat(Math.max(0, 58 - s.length))}`);

  // ══════════════════════════════════════════════ MODEL ROUTING
  section("MODEL ROUTING");
  check("routine compiler task routes to FAST",
    routeSupervisor({}).role === ROUTE_FAST);
  check("safety-policy issue routes to DEEP",
    routeSupervisor({ safetySemantics: true }).role === ROUTE_DEEP);
  check("proposal to weaken a gate routes to DEEP and is safety-critical",
    routeSupervisor({ weakensGate: true }).role === ROUTE_DEEP
    && routeSupervisor({ weakensGate: true }).safetyCritical === true);
  check("same worker failure twice routes to DEEP",
    routeSupervisor({ sameFailureCount: 2 }).role === ROUTE_DEEP);
  check("one failure alone stays FAST",
    routeSupervisor({ sameFailureCount: 1 }).role === ROUTE_FAST);
  check("foreman failure routes to DEEP",
    routeSupervisor({ foremanFailure: true }).role === ROUTE_DEEP);
  check("critic policy bug routes to DEEP",
    routeSupervisor({ criticPolicyBug: true }).role === ROUTE_DEEP);
  check("trusted-evidence issue routes to DEEP",
    routeSupervisor({ trustedEvidenceIssue: true }).role === ROUTE_DEEP);
  check("checkpoint ambiguity routes to DEEP",
    routeSupervisor({ checkpointAmbiguity: true }).role === ROUTE_DEEP);
  check("low FAST confidence escalates to DEEP",
    routeSupervisor({ fastConfidence: 0.31 }).role === ROUTE_DEEP);
  check("high FAST confidence stays FAST",
    routeSupervisor({ fastConfidence: 0.9 }).role === ROUTE_FAST);
  check("FAST asking to escalate routes to DEEP",
    routeSupervisor({ fastRequestsEscalation: true }).role === ROUTE_DEEP);
  check("preservation hash mismatch halts",
    routeSupervisor({ preservationHashMismatch: true }).stop === true);
  check("unexpected production file halts",
    routeSupervisor({ unexpectedProductionFile: true }).stop === true);
  check("visual screening routes to VISUAL",
    routeSupervisor({ needsVisualReview: true }).role === ROUTE_VISUAL);

  const resolved = nextSituationAfterResolution({ sameFailureCount: 3, foremanFailure: true, fastConfidence: 0.1 });
  check("resolved escalation returns to FAST",
    routeSupervisor(resolved).role === ROUTE_FAST,
    JSON.stringify(routeSupervisor(resolved)));
  check("resolved repeated-failure streak is actually zeroed",
    resolved.sameFailureCount === 0);
  const stillTrust = nextSituationAfterResolution({ trustedEvidenceIssue: true, sameFailureCount: 3 });
  check("DEEP stays DEEP when a trust-boundary issue remains after teaching",
    routeSupervisor(stillTrust).role === ROUTE_DEEP && routeSupervisor(stillTrust).safetyCritical === true);
  const stillPreserve = nextSituationAfterResolution({ preservationHashMismatch: true, sameFailureCount: 2 });
  check("preservation halt survives an escalation-resolution event",
    routeSupervisor(stillPreserve).stop === true);
  const stillGate = nextSituationAfterResolution({ weakensGate: true });
  check("a proposal to weaken a gate is not downgraded to FAST by resolution",
    routeSupervisor(stillGate).role === ROUTE_DEEP && routeSupervisor(stillGate).safetyCritical === true);

  check("manual FAST ONLY is honored for non-safety-critical deep work",
    routeSupervisor({ sameFailureCount: 2 }, { mode: MODE_FAST_ONLY }).role === ROUTE_FAST);
  check("manual FAST ONLY cannot downgrade a safety-critical decision",
    routeSupervisor({ safetySemantics: true }, { mode: MODE_FAST_ONLY }).role === ROUTE_HUMAN);
  check("manual DEEP ONLY is honored for routine work",
    routeSupervisor({}, { mode: MODE_DEEP_ONLY }).role === ROUTE_DEEP);
  check("AUTO mode leaves routing to the rules",
    routeSupervisor({}, { mode: MODE_AUTO }).role === ROUTE_FAST);

  // provider availability
  check("FAST unavailable falls back to DEEP for routine work",
    applyAvailability(routeSupervisor({}), { [ROUTE_FAST]: false, [ROUTE_DEEP]: true }).role === ROUTE_DEEP);
  check("DEEP unavailable falls back to FAST for non-safety-critical work",
    applyAvailability(routeSupervisor({ sameFailureCount: 2 }), { [ROUTE_FAST]: true, [ROUTE_DEEP]: false }).role === ROUTE_FAST);
  check("DEEP unavailable on a safety-critical decision pauses for a human",
    applyAvailability(routeSupervisor({ safetySemantics: true }), { [ROUTE_FAST]: true, [ROUTE_DEEP]: false }).role === ROUTE_HUMAN);
  check("no supervisor available pauses for a human",
    applyAvailability(routeSupervisor({}), { [ROUTE_FAST]: false, [ROUTE_DEEP]: false }).role === ROUTE_HUMAN);
  check("visual model unavailable pauses rather than guessing",
    applyAvailability(routeSupervisor({ needsVisualReview: true }), { [ROUTE_VISUAL]: false }).role === ROUTE_HUMAN);

  check("historical repair-spiral fixture routes to DEEP",
    routeSupervisor(HISTORICAL_FIXTURES.repairSpiral.situation).role === ROUTE_DEEP);
  check("historical self-grounding fixture routes to DEEP",
    routeSupervisor(HISTORICAL_FIXTURES.selfGrounding.situation).role === ROUTE_DEEP);
  check("historical sidecar-bak fixture halts",
    routeSupervisor(HISTORICAL_FIXTURES.sidecarBak.situation).stop === true);

  // ══════════════════════════════════════════════ STRUCTURED PROTOCOL
  section("STRUCTURED PROTOCOL");
  const pack = packWith();
  const v1 = validateSupervisorResult(validResult(), { pack });
  check("valid response accepted", v1.ok, v1.errors?.join(","));
  check("valid response preserves the decision", v1.result?.decision === "TASK");
  check("confidence is clamped into 0..1",
    validateSupervisorResult(validResult({ confidence: 4 }), { pack }).result.confidence === 1);

  const missing = validateSupervisorResult(validResult({ decision: undefined }), { pack });
  check("missing decision is rejected", !missing.ok);
  check("missing decision is repairable as a format problem", missing.formatOnly === true);
  check("missing decision yields no result object", missing.result === null);

  const garbage = validateSupervisorResult("Looks fine to me, ship it!", { pack });
  check("prose cannot become a silent PASS", !garbage.ok && garbage.result === null);
  check("garbage does not default to KEEP",
    !DECISIONS.some((d) => garbage.result && garbage.result.decision === d));

  const bogus = validateSupervisorResult(validResult({ decision: "MERGE" }), { pack });
  check("unsupported action rejected", !bogus.ok && bogus.errors.some((e) => e.startsWith("unsupported-decision")));

  check("TASK without a worker objective is rejected",
    !validateSupervisorResult(validResult({ workerObjective: null }), { pack }).ok);
  check("TASK without acceptance criteria is rejected",
    !validateSupervisorResult(validResult({ acceptance: [] }), { pack }).ok);
  check("ESCALATE without a reason is rejected",
    !validateSupervisorResult(validResult({ decision: "ESCALATE", escalationReason: null }), { pack }).ok);
  check("KEEP does not require a worker objective",
    validateSupervisorResult(validResult({ decision: "KEEP", workerObjective: null, acceptance: [] }), { pack }).ok);

  const widened = validateSupervisorResult(
    validResult({ allowedPaths: ["src/audio/AudioEngine.ts"] }),
    { pack, spec: { allowedPaths: ["src/components/**"] } },
  );
  check("supervisor cannot widen scope", !widened.ok && widened.errors.some((e) => e.startsWith("scope-widened")));
  check("scope widening is NOT treated as a repairable format error", widened.formatOnly === false);

  check("json is extracted from a fenced block amid prose",
    extractJsonObject("Here is my answer:\n```json\n{\"decision\":\"KEEP\"}\n```\nThanks!")?.decision === "KEEP");
  check("json extraction prefers the object containing a decision",
    extractJsonObject('{"note":"x"}\n{"decision":"STOP","reason":"y"}')?.decision === "STOP");
  check("json extraction survives braces inside strings",
    extractJsonObject('{"decision":"KEEP","reason":"the } brace"}')?.reason === "the } brace");

  // one — and only one — format repair
  let calls = 0;
  const repairOnce = await askSupervisor({
    role: ROUTE_FAST, model: "fake/model", prompt: "x", pack,
    invoke: async () => {
      calls += 1;
      return { ok: true, text: calls === 1 ? "I think we should keep it." : validResult({ decision: "KEEP" }), callId: `c${calls}`, durationMs: 1, error: null };
    },
  });
  check("malformed reply triggers exactly one format repair", calls === 2, `calls=${calls}`);
  check("repaired reply is accepted", repairOnce.ok && repairOnce.repaired === true);

  let calls2 = 0;
  const repairFails = await askSupervisor({
    role: ROUTE_FAST, model: "fake/model", prompt: "x", pack,
    invoke: async () => { calls2 += 1; return { ok: true, text: "still not json", callId: `c${calls2}`, durationMs: 1, error: null }; },
  });
  check("a second malformed reply does not trigger a third call", calls2 === 2, `calls=${calls2}`);
  check("unrepairable reply never becomes a decision", !repairFails.ok && repairFails.result === null);

  let calls3 = 0;
  const noRepairForSubstantive = await askSupervisor({
    role: ROUTE_FAST, model: "fake/model", prompt: "x", pack, spec: { allowedPaths: ["src/components/**"] },
    invoke: async () => { calls3 += 1; return { ok: true, text: validResult({ allowedPaths: ["src/audio/AudioEngine.ts"] }), callId: "c", durationMs: 1, error: null }; },
  });
  check("substantive violations are not re-rolled with a repair call", calls3 === 1, `calls=${calls3}`);
  check("substantive violation is reported, not accepted", !noRepairForSubstantive.ok);

  // ══════════════════════════════════════════════ TRUST BOUNDARY
  section("TRUST BOUNDARY");
  const tp = createEvidencePack({});
  const eRef = addEvidence(tp, {
    kind: "COMPILER_OUTPUT", label: "compile log",
    content: "ERROR: 0:61: 'ro' : undeclared identifier",
  });
  check("trusted evidence mints a ref", eRef === "E1");
  check("trusted actual evidence grounds a matching claim",
    groundsClaim(tp, "E1", "the identifier ro is undeclared at line 61").ok);
  check("model prose is rejected as evidence", (() => {
    try {
      addEvidence(tp, { kind: "MODEL_PROSE", label: "plan", content: "it already exists" });
      return false;
    } catch { return true; }
  })());
  check("every untrusted kind is refused", [...UNTRUSTED_KINDS].every((k) => {
    try {
      addEvidence(tp, { kind: k, label: "x", content: "y" });
      return false;
    } catch { return true; }
  }));
  check("unknown evidence kinds are refused", (() => {
    try {
      addEvidence(tp, { kind: "VIBES", label: "x", content: "y" });
      return false;
    } catch { return true; }
  })());

  const pathPack = createEvidencePack({});
  addEvidence(pathPack, { kind: "FILE_PATH", label: "allowed file", content: "src/state/presets/presetStore.ts" });
  check("a trusted path grounds existence",
    groundsClaim(pathPack, "E1", "src/state/presets/presetStore.ts", { mode: "existence" }).ok);
  check("a trusted path does NOT ground arbitrary content claims",
    !groundsClaim(pathPack, "E1", "presetStore.ts already exports restoreFromSnapshot and handles migration").ok);

  check("an invented file cannot be grounded by the plan",
    !groundsClaim(tp, "E1", "presetRestoreAdapter.ts already exposes restoreFromSnapshot").ok);
  check("unknown evidence refs are reported as missing",
    resolveRefs(tp, ["E1", "E99"]).missing.join(",") === "E99");
  check("citing an unknown ref invalidates the whole result",
    !validateSupervisorResult(validResult({ trustedEvidenceRefs: ["E42"] }), { pack }).ok);

  // ══════════════════════════════════════════════ PROCESS MANAGEMENT
  section("PROCESS MANAGEMENT");
  const args = supervisorRunArgs({ prompt: "hi", model: "opencode/x", title: "t", cwd: "/tmp" });
  check("invocation uses the verified headless flags",
    args[0] === "run" && args.includes("--format") && args[args.indexOf("--format") + 1] === "json");
  check("model is passed with -m", args[args.indexOf("-m") + 1] === "opencode/x");
  check("supervisor calls never pass --auto", !args.includes("--auto"));
  check("prompt is the final positional argument", args[args.length - 1] === "hi");
  // Real captured compiler logs contain NUL bytes; argv must survive them.
  const nulArgs = supervisorRunArgs({ prompt: "ERROR: 0:58: 'let'\n\u0000", model: "m", cwd: "/tmp" });
  check("NUL bytes in evidence are stripped from argv",
    !nulArgs[nulArgs.length - 1].includes("\u0000"));
  check("stripping NUL preserves the surrounding evidence text",
    nulArgs[nulArgs.length - 1].includes("ERROR: 0:58: 'let'"));

  const stream = parseSupervisorStream(
    '{"type":"step_start","part":{"type":"step-start"}}\n'
    + '{"type":"text","part":{"type":"text","text":"hello "}}\n'
    + '{"type":"text","part":{"type":"text","text":"world"}}\n'
    + '{"type":"step_finish","part":{"type":"step-finish","tokens":{"total":9},"cost":0,"reason":"stop"}}',
  );
  check("event stream concatenates text parts", stream.text === "hello world");
  check("event stream captures tokens and cost", stream.tokens?.total === 9 && stream.cost === 0);
  check("malformed stream lines are skipped, not fatal", parseSupervisorStream("not json\n{bad").text === "");

  // Regression guard: OpenCode snapshots the enclosing git worktree and can
  // restore it, which would silently revert uncommitted work.
  const sandbox = supervisorSandbox();
  check("the supervisor sandbox is outside the repository",
    !resolve(sandbox).toLowerCase().startsWith(resolve(repoRoot).toLowerCase()), sandbox);
  check("the supervisor sandbox is not inside any git repository",
    assertNotInGitRepo(sandbox) === true, sandbox);
  check("running a supervisor inside a git repo is refused", (() => {
    try { assertNotInGitRepo(repoRoot); return false; } catch { return true; }
  })());
  check("invocation cwd is the sandbox, never the repo",
    supervisorRunArgs({ prompt: "x", model: "m", cwd: sandbox })[args.indexOf("--dir") + 1] !== undefined);

  const cancelled = await invokeSupervisor({ prompt: "x", model: "m", signal: AbortSignal.abort() });
  check("cancellation before start is honored", cancelled.cancelled === true && cancelled.ok === false);

  const badBin = await invokeSupervisor({ prompt: "x", model: "m", bin: "definitely-not-a-real-binary-xyz", timeoutMs: 5000 });
  check("a missing provider binary fails as data, not an exception", badBin.ok === false && badBin.error != null);

  const timedOut = await invokeSupervisor({
    prompt: "x", model: "m",
    bin: process.execPath,
    timeoutMs: 400,
  });
  check("a call that produces no result is not reported as ok", timedOut.ok === false);

  check("DEEP supervisor timeout is minutes, not 15 minutes",
    SUPERVISOR_TIMEOUT_MS.DEEP_SUPERVISOR === 180000 && SUPERVISOR_TIMEOUT_MS.DEEP_SUPERVISOR < 15 * 60 * 1000);
  check("DEEP timeout is above the observed live successes (43s/65s) and under 5 minutes",
    SUPERVISOR_TIMEOUT_MS.DEEP_SUPERVISOR > 65 * 1000
      && SUPERVISOR_TIMEOUT_MS.DEEP_SUPERVISOR <= 5 * 60 * 1000);
  check("FAST timeout is tighter than DEEP",
    SUPERVISOR_TIMEOUT_MS.FAST_SUPERVISOR < SUPERVISOR_TIMEOUT_MS.DEEP_SUPERVISOR);
  check("supervisorTimeoutMs honors an explicit override",
    supervisorTimeoutMs(ROUTE_DEEP, 500) === 500);

  const hung = await invokeSupervisor({
    prompt: "x",
    model: "m",
    role: ROUTE_DEEP,
    bin: process.execPath,
    args: ["-e", "setTimeout(() => {}, 60000)"],
    timeoutMs: 400,
  });
  check("a hung DEEP provider is killed as timedOut data, not an exception",
    hung.ok === false && hung.timedOut === true && hung.error === "timeout",
    JSON.stringify({ ok: hung.ok, timedOut: hung.timedOut, error: hung.error, durationMs: hung.durationMs }));
  check("the hang test did not wait the old 900s default",
    hung.durationMs < 5000);

  let failCalls = 0;
  const providerDown = await askSupervisor({
    role: ROUTE_FAST, model: "fake/model", prompt: "x", pack,
    invoke: async () => { failCalls += 1; return { ok: false, error: "timeout", callId: "c", durationMs: 1, text: "" }; },
  });
  check("a failed provider call yields no decision", !providerDown.ok && providerDown.result === null);
  check("a failed provider call is not retried as a format repair", failCalls === 1);

  // ══════════════════════════════════════════════ ROBO PUPPY STATE
  section("ROBO PUPPY STATE");
  const asleep = visualPuppyState({ state: "IDLE", missionId: null, working: false });
  check("no task means sleeping", asleep.visual === "SLEEPING");
  check("sleeping explains itself from real state", /no mission/.test(asleep.why));
  check("a just-dispatched task means waking",
    visualPuppyState({ state: "IDLE", working: false }, { dispatchedAt: Date.now() }).visual === "WAKING");
  check("a stale dispatch does not stay stuck on waking",
    visualPuppyState({ state: "IDLE", working: false }, { dispatchedAt: Date.now() - 60000 }).visual === "SLEEPING");
  check("editing means working", visualPuppyState({ state: "EDITING", working: true }).visual === "WORKING");
  check("investigating means reading", visualPuppyState({ state: "INVESTIGATING", working: true }).visual === "READING");
  check("validating means validating", visualPuppyState({ state: "VALIDATING", working: true }).visual === "VALIDATING");
  check("a checkpoint makes him happy", visualPuppyState({ state: "CHECKPOINTING" }).visual === "HAPPY");
  check("completion makes him happy", visualPuppyState({ state: "COMPLETE", finished: true }).visual === "HAPPY");
  check("a pending teacher packet means waiting for the teacher",
    visualPuppyState({ state: "WAITING_FOR_TEACHER" }).visual === "WAITING_FOR_TEACHER");
  check("blocked means blocked", visualPuppyState({ state: "BLOCKED", blockedReason: "x" }).visual === "BLOCKED");
  check("a revert decision shows reverting",
    visualPuppyState({ state: "REPAIRING" }, { lastDecision: "REVERT" }).visual === "REVERTING");
  check("a retry decision shows confusion",
    visualPuppyState({ state: "REPAIRING" }, { lastDecision: "RETRY" }).visual === "CONFUSED");
  check("a provider failure shows error",
    visualPuppyState({ state: "EDITING" }, { providerError: "boom" }).visual === "ERROR");
  check("he is never shown working while idle",
    visualPuppyState({ state: "IDLE", working: false }).visual !== "WORKING");
  check("a stale terminal state from a previous mission is not shown as current",
    visualPuppyState({ state: "BLOCKED", working: false }, { noActiveRun: true }).visual === "SLEEPING");
  check("a completed run rests as happy rather than asleep",
    visualPuppyState({ state: "COMPLETE", working: false }, { noActiveRun: true, lastRunCompleted: true }).visual === "HAPPY");
  check("a live run still reports its real state",
    visualPuppyState({ state: "EDITING", working: true }, { noActiveRun: false }).visual === "WORKING");
  // An unbound (fixture) run must not inherit an unrelated mission's phase.
  check("an unrelated mission's BLOCKED phase does not leak into a fixture run",
    visualPuppyState({ state: "BLOCKED", working: false }, { missionBound: false }).visual === "SLEEPING");
  check("a fixture run shows working while the worker actually executes",
    visualPuppyState({ state: "BLOCKED" }, { missionBound: false, workerBusy: true }).visual === "WORKING");
  check("a fixture run shows waiting for the teacher during deep escalation",
    visualPuppyState({ state: "BLOCKED" }, { missionBound: false, awaitingDeep: true }).visual === "WAITING_FOR_TEACHER");
  check("a fixture run wakes on dispatch",
    visualPuppyState({ state: "BLOCKED" }, { missionBound: false, dispatchedAt: Date.now() }).visual === "WAKING");
  // A mission started from the CLI must show through a console that has no
  // session of its own, rather than being reported as idle.
  check("a CLI-launched mission shows real runner state in an idle console",
    visualPuppyState({ state: "EDITING", working: true }, { noActiveRun: true }).visual === "WORKING");
  check("an idle console with no live mission still sleeps",
    visualPuppyState({ state: "COMPLETE", working: false }, { noActiveRun: true }).visual === "SLEEPING");

  const unboundPanel = puppyPanel({ hints: { missionBound: false, awaitingDeep: true } });
  check("an unbound run shows no stale mission id", unboundPanel.missionId === null, String(unboundPanel.missionId));
  check("an unbound run shows no stale counters", Object.keys(unboundPanel.counters || {}).length === 0);
  check("an unbound run's speech matches the state it displays",
    unboundPanel.speech === VISUAL_MOOD.WAITING_FOR_TEACHER, unboundPanel.speech);
  check("an unbound run reports no canonical runner phase", unboundPanel.canonicalState === null);
  check("every visual state is declared", VISUAL_STATES.includes(visualPuppyState({ state: "PLANNING" }).visual));
  check("visual state always reports the canonical state it came from",
    visualPuppyState({ state: "EDITING" }).canonical === "EDITING");

  // ══════════════════════════════════════════════ STOP / PAUSE
  section("STOP SAFELY AND PAUSE");
  const s1 = new MediatorSession({ brief: "b" });
  s1.stopSafely();
  check("stop safely sets the stop flag", s1.stopRequested === true);
  check("stop safely does not abort in-flight work by default", s1.abort.signal.aborted === false);
  const s2 = new MediatorSession({ brief: "b" });
  s2.stopSafely({ cancelInFlight: true });
  check("explicit cancel does abort in-flight work", s2.abort.signal.aborted === true);
  const s3 = new MediatorSession({ brief: "b" });
  s3.state = "RUNNING";
  s3.pauseAfterCurrentTask();
  check("pause after current task is requested, not immediate", s3.pauseRequested === true && s3.state === "PAUSING");
  const s4 = new MediatorSession({ brief: "  exact brief text  " });
  check("the original human brief is stored verbatim", s4.humanBrief === "  exact brief text  ");
  check("a new session starts with no operational objective", s4.operationalObjective === null);

  let launched = 0;
  const s5 = new MediatorSession({ brief: "b", maxTasks: 5 });
  s5.stopRequested = true;
  s5.gatherEvidence = async () => { launched += 1; return { family: "unknown", items: [] }; };
  await s5.start();
  check("stop safely launches no new model work", launched === 0, `launched=${launched}`);
  check("a stopped run reports STOPPED", s5.state === "STOPPED");

  // ── forward-progress guards ───────────────────────────────────────────────
  // A review-only decision advances nothing. Repeating one must end the run
  // rather than spinning and burning provider calls.
  const mkAsk = (decision) => async () => ({
    ok: true, calls: [{ callId: "c", ok: true, durationMs: 1, error: null }],
    result: {
      decision, reason: "settled for the purposes of this test", workerObjective: null,
      acceptance: [], trustedEvidenceRefs: [], allowedPaths: [], forbiddenPaths: [],
      recommendedModelCalls: 1, confidence: 0.9, teachingLevel: 0, escalationReason: null,
    },
  });
  // In-memory registry so stub latencies never reach the real telemetry file.
  // Roles are populated because these tests exercise loop control, not availability.
  const memReg = () => {
    let r = {
      version: 1,
      roles: { FAST_SUPERVISOR: "test/fast", DEEP_SUPERVISOR: "test/deep", VISUAL_REVIEW: "test/visual", ROBO_PUPPY: "test/puppy" },
      models: {},
    };
    return { load: () => r, save: (x) => { r = x; } };
  };
  const alwaysKeep = new MediatorSession({ brief: "b", maxTasks: 50, ask: mkAsk("KEEP"), registry: memReg() });
  alwaysKeep.gatherEvidence = async () => ({ family: "unknown", situationText: "s", items: [] });
  alwaysKeep.runWorker = async () => ({ summary: "", byteDelta: 0, changedFiles: [], outcome: "KEEP" });
  await alwaysKeep.start();
  check("a repeated review decision ends the run instead of looping",
    alwaysKeep.state === "COMPLETE", `state=${alwaysKeep.state} calls=${alwaysKeep.supervisorCalls}`);
  check("an idle-review run does not burn the whole call budget",
    alwaysKeep.supervisorCalls <= 3, `calls=${alwaysKeep.supervisorCalls}`);

  // An always-escalating supervisor must hit the hard call ceiling, not run forever.
  const alwaysEsc = new MediatorSession({
    brief: "b", maxTasks: 50, maxSupervisorCalls: 5, registry: memReg(),
    ask: async () => ({
      ok: true, calls: [{ callId: "c", ok: true, durationMs: 1, error: null }],
      result: {
        decision: "ESCALATE", reason: "always escalating in this test", workerObjective: null,
        acceptance: [], trustedEvidenceRefs: [], allowedPaths: [], forbiddenPaths: [],
        recommendedModelCalls: 1, confidence: 0.9, teachingLevel: 0, escalationReason: "test",
      },
    }),
  });
  alwaysEsc.gatherEvidence = async () => ({ family: "unknown", situationText: "s", items: [] });
  await alwaysEsc.start();
  check("the supervisor call budget is a hard ceiling",
    alwaysEsc.supervisorCalls <= 6 && alwaysEsc.state === "BLOCKED",
    `calls=${alwaysEsc.supervisorCalls} state=${alwaysEsc.state}`);
  check("budget exhaustion is reported as needing a human",
    /call budget exhausted/.test(alwaysEsc.blockedReason || ""), alwaysEsc.blockedReason);

  // ══════════════════════════════════════════════ PRODUCTION DISPATCH
  section("PRODUCTION DISPATCH");
  check("production dispatch refuses to construct without authorization", (() => {
    try {
      // eslint-disable-next-line no-new
      new MissionMediatorSession({ baseSpecPath: "nope.md", brief: "b" });
      return false;
    } catch (e) { return /authorization/i.test(e.message); }
  })());
  check("an unauthorized attempt names the confirming flag", (() => {
    try { new MissionMediatorSession({ baseSpecPath: "nope.md", brief: "b" }); return false; }
    catch (e) { return e.message.includes("--authorize-production"); }
  })());

  const baseAllowed = ["src/components/Visualizer/singularity.ts"];
  check("supervisor scope is intersected, never widened",
    intersectScope(["src/audio/AudioEngine.ts"], baseAllowed).join(",") === baseAllowed.join(","));
  check("a permitted path survives intersection",
    intersectScope(["src/components/Visualizer/singularity.ts"], baseAllowed).length === 1);
  check("an empty supervisor scope falls back to the base scope",
    intersectScope([], baseAllowed).join(",") === baseAllowed.join(","));
  check("a glob base scope still admits a matching concrete path",
    intersectScope(["src/components/FireCommand/GatePanel.tsx"], ["src/components/FireCommand/**"]).length === 1);

  check("the parked Fire Command files are always preserved",
    ALWAYS_PRESERVED.length === 3
    && ALWAYS_PRESERVED.every((p) => p.startsWith("src/components/FireCommand/")));
  const pre = hashPreserved(ALWAYS_PRESERVED);
  check("preserved files hash to real content", Object.values(pre).every((h) => typeof h === "string" && h.length === 64));
  check("identical hashes report no drift", diffPreserved(pre, { ...pre }).length === 0);
  check("a changed hash is reported as drift",
    diffPreserved(pre, { ...pre, [ALWAYS_PRESERVED[0]]: "deadbeef" }).join(",") === ALWAYS_PRESERVED[0]);
  check("preservation drift routes to a safety-critical halt", (() => {
    const d = routeSupervisor({ preservationHashMismatch: true });
    return d.stop === true && d.safetyCritical === true;
  })());

  // Regression for the first production run: a supervisor criterion containing
  // an ellipsis threw the runner. The schema root cause is fixed, so the
  // Mediator must now pass criteria through untouched.
  const critProse = "declare vec3 ro = ... before line 61";
  check("acceptance criteria reach the spec verbatim",
    acceptanceForSpec([critProse])[0] === critProse);
  check("blank criteria are dropped without altering the rest",
    acceptanceForSpec(["  ", critProse, ""]).length === 1);
  check("a verbatim ellipsis criterion now parses in a real mission spec", (() => {
    const p = parseMissionMarkdown(`---
{"id":"acc-prose","title":"t","goal":"g","level":1,"allowedPaths":["src/a.ts"],"acceptance":${JSON.stringify([critProse])}}
---

Body.`);
    return p.ok && p.spec.acceptance[0] === critProse;
  })());

  // Regression: a thrown runner must not be absorbed as a normal outcome.
  const crashed = new MediatorSession({
    brief: "b", maxTasks: 3, registry: memReg(),
    ask: mkAsk("TASK"),
  });
  crashed.gatherEvidence = async () => ({ family: "unknown", situationText: "s", items: [] });
  crashed.runWorker = async () => ({
    summary: "runner threw: boom", byteDelta: 0, changedFiles: [],
    infrastructureFailure: true, error: "boom", outcome: "RETRY",
  });
  await crashed.start();
  check("a thrown runner fails the run instead of reporting COMPLETE",
    crashed.state === "FAILED", `state=${crashed.state}`);
  check("an infrastructure failure names itself in the blocked reason",
    /infrastructure failure/.test(crashed.blockedReason || ""), crashed.blockedReason);

  // ── field run_mto1hfmy_e7aeb7 regressions ────────────────────────────────
  section("FIELD RUN REGRESSIONS");
  check("the field run is recorded as real production, not a fixture",
    FIELD_RUN_MTO1HFMY.production === true && FIELD_RUN_MTO1HFMY.fixture === false);
  check("the field run spent 19 Puppy calls for zero edit invocations",
    FIELD_RUN_MTO1HFMY.puppyCalls === 19 && FIELD_RUN_MTO1HFMY.editInvocations === 0);
  check("after DEEP teaching the next field route stayed DEEP (the stickiness bug)",
    FIELD_RUN_MTO1HFMY.routes[2].escalationResolved === true
      && FIELD_RUN_MTO1HFMY.routes[3].role === "DEEP_SUPERVISOR"
      && FIELD_RUN_MTO1HFMY.routes[3].ruleId === "repeated-worker-failure");

  const micro = writeMicroMission({
    base: {
      level: 1,
      allowedPaths: ["src/components/Visualizer/singularity.ts"],
      readOnlyPaths: [],
      forbiddenPaths: [],
      preserveDirtyPaths: [],
      adoptDirtyPaths: [],
      validation: { required: ["typecheck"] },
      maxRetriesPerPhase: 2,
      maxModelCalls: 20,
      maxWallClockMs: 60_000,
      sessionTimeoutMs: 60_000,
      checkpointPolicy: "state-only",
      diff: { maxFiles: 40, maxInsertions: 2500, warnOnly: true },
    },
    result: {
      workerObjective: "Declare missing ro and dt.",
      acceptance: ["compiler family advances"],
      allowedPaths: ["src/components/Visualizer/singularity.ts"],
      forbiddenPaths: [],
      recommendedModelCalls: 6,
    },
    id: "night-budget-alloc-test",
    humanBrief: "field m03",
  });
  try {
    check("Prism's field recommendation of 6 is raised so an edit reserve exists",
      micro.front.maxModelCalls === allocateMicroMissionCallBudget(6, 20, { edits: true })
        && micro.front.maxModelCalls === 8,
      `maxModelCalls=${micro.front.maxModelCalls}`);
  } finally {
    if (existsSync(micro.path)) unlinkSync(micro.path);
  }

  class StreakSession extends MediatorSession {
    constructor(opts) {
      super(opts);
      this.sameFailureRun = 0;
    }
    onEscalationResolved() {
      this.sameFailureRun = 0;
    }
  }
  const gears = [];
  const streak = new StreakSession({
    brief: "compiler microfix",
    maxTasks: 4,
    registry: memReg(),
    ask: async ({ role }) => ({
      ok: true,
      calls: [{ callId: "c", ok: true, durationMs: 1, error: null }],
      result: {
        decision: role === ROUTE_DEEP ? "RETRY" : "TASK",
        reason: "bounded worker task",
        workerObjective: "one-line compiler repair",
        acceptance: ["compiles"],
        trustedEvidenceRefs: [],
        allowedPaths: ["src/a.ts"],
        forbiddenPaths: [],
        recommendedModelCalls: 6,
        confidence: 0.9,
        teachingLevel: 1,
        escalationReason: null,
      },
    }),
  });
  const streakEmit = streak.emit.bind(streak);
  streak.emit = (event) => {
    if (event.kind === "ROUTE") gears.push(event.role);
    return streakEmit(event);
  };
  streak.gatherEvidence = async () => ({ family: "typescript_microfix", situationText: "s", items: [] });
  streak.runWorker = async () => {
    streak.sameFailureRun += 1;
    return {
      summary: "blocked",
      byteDelta: 0,
      changedFiles: [],
      failureClass: "BUDGET_EXHAUSTED",
      outcome: "RETRY",
      situation: { sameFailureCount: streak.sameFailureRun },
    };
  };
  await streak.start();
  check("FAST → FAST → DEEP → FAST after DEEP teaching (issue-local escalation)",
    gears[0] === ROUTE_FAST && gears[1] === ROUTE_FAST && gears[2] === ROUTE_DEEP && gears[3] === ROUTE_FAST,
    gears.join(" → "));

  const timeoutRoles = [];
  let deepTimeoutMs = null;
  const deepTimeout = new MediatorSession({
    brief: "b",
    maxTasks: 1,
    registry: memReg(),
    ask: async ({ role, timeoutMs }) => {
      timeoutRoles.push(role);
      if (role === ROUTE_DEEP) {
        deepTimeoutMs = timeoutMs;
        return { ok: false, reason: "timeout", calls: [{ timedOut: true, ok: false, durationMs: 180000, error: "timeout" }] };
      }
      return {
        ok: true,
        calls: [{ callId: "c", ok: true, durationMs: 1, error: null }],
        result: {
          decision: "TASK",
          reason: "FAST fallback after DEEP timeout",
          workerObjective: "one-line compiler repair",
          acceptance: ["compiles"],
          trustedEvidenceRefs: [],
          allowedPaths: ["src/a.ts"],
          forbiddenPaths: [],
          recommendedModelCalls: 6,
          confidence: 0.9,
          teachingLevel: 1,
          escalationReason: null,
        },
      };
    },
  });
  deepTimeout.situation = { sameFailureCount: 2 };
  deepTimeout.gatherEvidence = async () => ({ family: "typescript_microfix", situationText: "s", items: [] });
  deepTimeout.runWorker = async () => ({
    summary: "ok", byteDelta: 1, changedFiles: ["src/a.ts"], outcome: "KEEP",
  });
  await deepTimeout.start();
  check("DEEP timeout on routine work falls back to FAST and continues the run",
    deepTimeout.state === "COMPLETE" && timeoutRoles[0] === ROUTE_DEEP && timeoutRoles.includes(ROUTE_FAST),
    `state=${deepTimeout.state} roles=${timeoutRoles.join(",")} reason=${deepTimeout.blockedReason || ""}`);
  check("the session asked DEEP with the role timeout, not 900s",
    deepTimeoutMs === SUPERVISOR_TIMEOUT_MS.DEEP_SUPERVISOR);
  check("a routine DEEP timeout does not leave blockedReason=timeout",
    deepTimeout.blockedReason !== "timeout");

  let safetyWorker = 0;
  const safetyTimeout = new MediatorSession({
    brief: "b",
    maxTasks: 3,
    registry: memReg(),
    ask: async () => ({
      ok: false,
      reason: "timeout",
      calls: [{ timedOut: true, ok: false, durationMs: 180000, error: "timeout" }],
    }),
  });
  safetyTimeout.situation = { trustedEvidenceIssue: true };
  safetyTimeout.gatherEvidence = async () => ({ family: "unknown", situationText: "s", items: [] });
  safetyTimeout.runWorker = async () => {
    safetyWorker += 1;
    return { summary: "should not run", byteDelta: 0, changedFiles: [], outcome: "RETRY" };
  };
  await safetyTimeout.start();
  check("DEEP timeout on a safety-critical decision stops safely",
    safetyTimeout.state === "BLOCKED" && /DEEP_TIMEOUT/.test(safetyTimeout.blockedReason || "") && /safety-critical/.test(safetyTimeout.blockedReason || ""),
    safetyTimeout.blockedReason);
  check("safety-critical DEEP timeout does not silently dispatch the worker",
    safetyWorker === 0);

  // ══════════════════════════════════════════════ WORKTREE BASELINE
  section("WORKTREE BASELINE");
  check("CRLF is detected without being corrected",
    eolProfile(Buffer.from("a\r\nb\r\n")) === "crlf");
  check("LF is detected", eolProfile(Buffer.from("a\nb\n")) === "lf");
  check("mixed endings are reported as mixed",
    eolProfile(Buffer.from("a\r\nb\nc\n")) === "mixed");

  const live = captureBaseline({ note: "test" });
  check("baseline captures the whole porcelain", live.files.length > 0 && live.porcelain.length > 0);
  check("baseline records a sha256 for every readable dirty file",
    live.files.filter((f) => f.dirt !== "deleted" && f.dirt !== "unreadable").every((f) => typeof f.sha256 === "string" && f.sha256.length === 64));
  check("dirt is classified, not cleaned",
    live.counts.semantic + live.counts.eolOnly + live.counts.untracked + live.counts.deleted === live.counts.total);
  check("line-ending churn is distinguished from semantic dirt",
    live.counts.eolOnly > 0 && live.counts.semantic > 0,
    `eol=${live.counts.eolOnly} semantic=${live.counts.semantic}`);

  const prot = protectedProductionFiles(live);
  check("the parked Fire Command files are identified as protected production dirt",
    ALWAYS_PRESERVED.every((p) => prot.some((x) => x.path === p)),
    prot.map((p) => p.path).join(", "));
  check("line-ending churn is not treated as protected production work",
    prot.every((p) => live.files.find((f) => f.path === p.path).dirt === "semantic"));

  // Simulate the exact failure that happened during development: a snapshot
  // restore silently reverting parked files back to HEAD.
  const victim = prot[0];
  const headSha = live.files.find((f) => f.path === victim.path).headSha256;
  const reverted = {
    ...live,
    files: live.files.filter((f) => f.path !== victim.path),
  };
  const v = verifyBaseline(live, { now: reverted });
  check("a file silently reverted to HEAD is detected",
    v.revertedToHead.some((r) => r.path === victim.path) || v.vanished.some((r) => r.path === victim.path),
    JSON.stringify({ reverted: v.revertedToHead.length, vanished: v.vanished.length }));
  check("losing parked semantic work is reported as unsafe", v.safe === false);
  check("a clean comparison reports safe", verifyBaseline(live, { now: live }).safe === true);
  check("a clean comparison reports ok", verifyBaseline(live, { now: live }).ok === true);
  check("HEAD hash is recorded so a revert is recognisable",
    typeof headSha === "string" && headSha.length === 64);

  const contentChanged = {
    ...live,
    files: live.files.map((f) => (f.path === victim.path ? { ...f, sha256: "0".repeat(64) } : f)),
  };
  const v2 = verifyBaseline(live, { now: contentChanged });
  check("an in-place content change is reported as changed, not lost",
    v2.changed.some((c) => c.path === victim.path) && v2.revertedToHead.length === 0);

  // ══════════════════════════════════════════════ IDENTITY
  section("IDENTITY");
  const goodId = {
    displayName: "Prism", tagline: "t",
    avatar: { concept: "a triangular prism splitting a beam", shapeLanguage: "sharp facets", symbols: ["▲"] },
    theme: GOOD_THEME, visualStyle: "v", motionStyle: "m", personality: "p", rationale: "r",
  };
  const okId = validateIdentity(goodId);
  check("a well-formed identity manifest validates", okId.ok, okId.errors?.join(","));
  check("theme values are canonicalized to hex", okId.identity.theme.primary === "#6b3fa0");

  check("css injection in a colour is rejected",
    !validateIdentity({ ...goodId, theme: { ...GOOD_THEME, primary: "red;} body{display:none}" } }).ok);
  check("url() in a colour is rejected",
    !validateIdentity({ ...goodId, theme: { ...GOOD_THEME, primary: "url(http://x/a.png)" } }).ok);
  check("javascript: in a colour is rejected",
    !validateIdentity({ ...goodId, theme: { ...GOOD_THEME, primary: "javascript:alert(1)" } }).ok);
  check("sanitizeColor only ever emits hex", ["#abc", "#AABBCC", "#11223344"].every((c) => /^#[0-9a-f]{6,8}$/.test(sanitizeColor(c))));
  check("sanitizeColor rejects everything else",
    ["red", "rgb(1,2,3)", "expression(x)", "#12", "", null, "#ggg"].every((c) => sanitizeColor(c) === null));
  check("script tags in text are neutralized to plain text",
    !/[\u0000-\u001f]/.test(sanitizeText("a\u0000b\u001fc")));

  check("unreadable text on background is rejected",
    !validateIdentity({ ...goodId, theme: { ...GOOD_THEME, text: "#101010" } }).ok);
  check("contrast maths is correct", Math.abs(contrastRatio("#ffffff", "#000000") - 21) < 0.01);
  check("an identity too close to Robo Puppy green is rejected",
    !validateIdentity({ ...goodId, theme: { ...GOOD_THEME, primary: "#40ffb5" } }).ok);
  check("a dog avatar is rejected as confusable with Robo Puppy",
    !validateIdentity({ ...goodId, avatar: { ...goodId.avatar, concept: "a friendly robot puppy" } }).ok);
  check("an unexpected but coherent avatar is allowed",
    validateIdentity({ ...goodId, avatar: { ...goodId.avatar, concept: "a floating obsidian monolith" } }).ok);
  check("reusing Robo Puppy green as a success colour is allowed",
    validateIdentity(goodId).identity.theme.success === PUPPY_ACCENT);

  const svg = renderAvatarSvg(okId.identity);
  check("avatar renders deterministically", renderAvatarSvg(okId.identity) === svg);
  check("avatar exposes stable animation hooks", svg.includes("mdr-gear") && svg.includes("mdr-core"));
  check("avatar contains no script", !/<script/i.test(svg) && !/onload/i.test(svg));
  check("avatar shape family follows the stated concept",
    chooseShapeFamily({ concept: "a watching eye" }) === "eye"
    && chooseShapeFamily({ concept: "an archive lattice" }) === "lattice");

  // ══════════════════════════════════════════════ PORTS
  section("PORTS AND ISOLATION");
  // The Mediator must not sit in a range another tooling surface will grab
  // during its own port discovery, and it must not require those files to change.
  const mediatorPorts = [MEDIATOR_PORT, ...MEDIATOR_PORT_FALLBACKS];
  check("the mediator port is 5185", MEDIATOR_PORT === 5185);
  check("the mediator never binds the application port",
    !mediatorPorts.includes(5173));
  check("no mediator port collides with the puppy watch scan",
    !mediatorPorts.some((p) => WATCH_PORT_SCAN.includes(p)),
    `watch=${WATCH_PORT_SCAN.join(",")} mediator=${mediatorPorts.join(",")}`);
  check("no mediator port collides with the harness scan",
    !mediatorPorts.some((p) => HARNESS_PORT_SCAN.includes(p)),
    `harness=${HARNESS_PORT_SCAN.join(",")} mediator=${mediatorPorts.join(",")}`);
  check("the puppy watch scan was left at its original five ports",
    WATCH_PORT_SCAN.join(",") === "5176,5177,5178,5179,5181", WATCH_PORT_SCAN.join(","));
  check("the watch server still owns 5176", WATCH_PORT === 5176);
  check("the Prism launcher targets 5185, never 5173 or 5176",
    PRISM_PORT === 5185 && PRISM_ORIGIN === "http://127.0.0.1:5185" && !/5176/.test(PRISM_ORIGIN));
  check("the Prism Chrome profile is not the old puppy watch profile",
    /kc-prism-console/.test(prismChromeProfile()) && !/kc-puppy-watch/.test(prismChromeProfile()));
  const consoleHtml = readFileSync(join(repoRoot, "tools/killchain-ai/src/mediator/console-page.html"), "utf8");
  check("Prism plays the bark file, not a beep", /bark\.mp3/.test(consoleHtml) && !/createOscillator/.test(consoleHtml));
  check("the bark asset is on disk", existsSync(join(repoRoot, "tools/killchain-ai/assets/robo-puppy-bark.mp3")));
  check("Prism serves /bark.mp3", /\/bark\.mp3/.test(readFileSync(join(repoRoot, "tools/killchain-ai/src/mediator/server.mjs"), "utf8")));
  let refused = false;
  try { await pickPort({ preferred: 5173 }); } catch { refused = true; }
  check("binding 5173 is refused outright", refused);

  // ══════════════════════════════════════════════ BENCHMARK SCORING
  section("BENCHMARK SCORING");
  const bfix = BENCHMARK_CASES.find((c) => c.id === "keep-vs-revert");
  const bpack = packForFixture(bfix);
  const scored = scoreCase(bfix, {
    ok: true, repaired: false, latencyMs: 1200, calls: 1, pack: bpack,
    result: { decision: "KEEP", reason: "PROGRESS per the deterministic comparison", trustedEvidenceRefs: ["E3"], allowedPaths: [], acceptance: [], workerObjective: null, confidence: 0.8 },
  });
  check("a correct keep is scored correct", scored.decisionCorrect && scored.structuredValid);
  check("citing evidence is recorded", scored.citedEvidence);
  const scoredBad = scoreCase(bfix, {
    ok: true, repaired: false, latencyMs: 10, calls: 1, pack: bpack,
    result: { decision: "REVERT", reason: "x", trustedEvidenceRefs: [], allowedPaths: [], acceptance: [], workerObjective: null, confidence: 0.2 },
  });
  check("a wrong decision is scored wrong", !scoredBad.decisionCorrect);
  check("an unparseable reply scores as invalid, not as a wrong answer",
    scoreCase(bfix, { ok: false, reason: "timeout", repaired: false, latencyMs: 1, calls: 1, pack: bpack }).structuredValid === false);
  check("invented paths are detected",
    inventedPaths({ allowedPaths: ["src/made/up/File.ts"], workerObjective: "", reason: "" }, bpack).length === 1);
  check("evidence-backed paths are not flagged as invented",
    inventedPaths({ allowedPaths: [], workerObjective: "", reason: "" }, bpack).length === 0);
  check("every benchmark case declares expected decisions",
    BENCHMARK_CASES.every((c) => Array.isArray(c.expect.decisions) && c.expect.decisions.length > 0));
  check("every benchmark case supplies only trusted evidence",
    BENCHMARK_CASES.every((c) => c.evidence.every((e) => !UNTRUSTED_KINDS.has(e.kind))));
  check("the trusted-evidence case keeps its unsupported claim out of the pack",
    BENCHMARK_CASES.find((c) => c.id === "trusted-evidence").evidence.every((e) => !e.content.includes("presetRestoreAdapter")));

  // ══════════════════════════════════════════════ DISCOVERY
  section("MODEL DISCOVERY");
  const parsedModels = parseVerboseModels(
    'opencode/demo-free\n{"id":"demo-free","providerID":"opencode","name":"Demo","cost":{"input":0,"output":0},"limit":{"context":262144},"capabilities":{"toolcall":true,"reasoning":true,"input":{"image":false}},"status":"active"}\n'
    + 'opencode/demo-paid\n{"id":"demo-paid","providerID":"opencode","name":"Paid","cost":{"input":3,"output":15},"limit":{"context":200000},"capabilities":{"toolcall":true,"reasoning":true,"input":{"image":true}},"status":"active"}',
  );
  check("verbose model output parses", parsedModels.length === 2);
  check("zero cost is reported as FREE", parsedModels[0].costClass === "FREE");
  check("nonzero cost is reported as PAID", parsedModels[1].costClass === "PAID");
  check("missing metadata reports UNKNOWN rather than guessing",
    parseVerboseModels("opencode/x\n").length === 0
    && (await import("./modelDiscovery.mjs")).parsePlainModels("opencode/x")[0].costClass === "UNKNOWN");
  check("image capability drives visual eligibility",
    roleEligibility(parsedModels[1]).VISUAL_REVIEW === true
    && roleEligibility(parsedModels[0]).VISUAL_REVIEW === false);
  check("local models are not eligible as supervisors",
    roleEligibility({ local: true, status: "active", contextLimit: 65536, toolcall: true, reasoning: false }).FAST_SUPERVISOR === false);
  check("task families are normalized", normalizeFamily("not_a_family") === "unknown" && normalizeFamily("empty_edit") === "empty_edit");

  log(`\n${passed} passed, ${failed} failed`);
  return { passed, failed };
}
