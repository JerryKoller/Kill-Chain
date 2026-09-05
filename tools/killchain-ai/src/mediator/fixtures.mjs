/**
 * Benchmark and regression fixtures.
 *
 * These are harmless: no fixture runs a mission, touches production, or needs a
 * provider. Where possible they reuse sanitized copies of the real compiler
 * trail and real historical failure modes rather than invented scenarios.
 */
import {
  OVERNIGHT_LET_LOG,
  OVERNIGHT_RO_DT_LOG,
} from "../overnight/diagnosticFingerprint.mjs";
import { addEvidence, createEvidencePack } from "./trust.mjs";

/** Build the evidence pack for a fixture. Only trusted kinds are ever added. */
export function packForFixture(fixture) {
  const pack = createEvidencePack({ missionId: fixture.id, note: fixture.title });
  for (const e of fixture.evidence) addEvidence(pack, e);
  return pack;
}

export const BENCHMARK_CASES = [
  {
    id: "compiler-classification",
    family: "compiler_microfix",
    title: "Classify a compiler diagnostic transition",
    humanBrief: "Get the Singularity scene shader compiling again.",
    objective: "Determine whether the last worker attempt moved the compiler forward.",
    situation: {},
    evidence: [
      {
        kind: "COMPILER_OUTPUT",
        label: "shader compile log BEFORE the attempt",
        source: "SCENE_SHADER_COMPILE",
        content: OVERNIGHT_LET_LOG,
      },
      {
        kind: "COMPILER_OUTPUT",
        label: "shader compile log AFTER the attempt",
        source: "SCENE_SHADER_COMPILE",
        content: OVERNIGHT_RO_DT_LOG,
      },
      {
        kind: "DIAGNOSTIC_FINGERPRINT",
        label: "deterministic fingerprint comparison",
        source: "diagnosticFingerprint.compareDiagnostics",
        content: "before.minLine=58 after.minLine=61 stage unchanged primaryGone=true kind=PROGRESS",
      },
    ],
    expect: {
      decisions: ["KEEP"],
      rationale: "Same stage, but the failure moved from line 58 to line 61 and the primary diagnostic is gone. That is progress, not stagnation.",
      requireObjective: false,
      mustCite: true,
      escalationExpected: false,
    },
  },

  {
    id: "next-micro-task",
    family: "compiler_microfix",
    title: "Turn one diagnosed error into one narrow worker objective",
    humanBrief: "Get the Singularity scene shader compiling again.",
    objective: "Create the next single task for Robo Puppy.",
    situation: {},
    evidence: [
      {
        kind: "COMPILER_OUTPUT",
        label: "current shader compile log",
        source: "SCENE_SHADER_COMPILE",
        content: OVERNIGHT_RO_DT_LOG,
      },
      {
        kind: "FILE_PATH",
        label: "the only editable file for this mission",
        source: "mission.allowedPaths",
        content: "src/components/Visualizer/singularity.ts",
      },
    ],
    expect: {
      decisions: ["TASK"],
      rationale: "One diagnosed error family should become exactly one narrow objective.",
      requireObjective: true,
      mustCite: true,
      escalationExpected: false,
      maxAllowedPaths: 1,
    },
  },

  {
    id: "empty-edit",
    family: "empty_edit",
    title: "Worker claims a fix but produced zero bytes",
    humanBrief: "Fix the failing typecheck in the Fire Command gate panel.",
    objective: "Review the worker's claimed fix.",
    situation: {},
    evidence: [
      {
        kind: "GIT_OUTPUT",
        label: "git status --porcelain after the edit phase",
        source: "gitops.gitPorcelain",
        content: "(no output — working tree unchanged)",
      },
      {
        kind: "HASH",
        label: "phase byte-delta from attribution fingerprints",
        source: "attribution.enforcePhaseDelta",
        content: "changedFiles=0 dirty=[] byteDelta=0",
      },
      {
        kind: "RUNNER_EVIDENCE",
        label: "edit outcome classification",
        source: "editGate.classifyEditOutcome",
        content: "kind=EMPTY_EDIT empty=true mutationToolUsed=false emptyEditStreak=1",
      },
    ],
    expect: {
      decisions: ["RETRY", "TASK"],
      rationale: "Zero byte delta means nothing was implemented. The claim is not evidence.",
      requireObjective: true,
      mustCite: true,
      escalationExpected: false,
    },
  },

  {
    id: "scope-violation",
    family: "scope_discipline",
    title: "Diff touches a forbidden path",
    humanBrief: "Adjust only the gate panel spacing.",
    objective: "Review the produced diff.",
    situation: { unexpectedProductionFile: true },
    evidence: [
      {
        kind: "GIT_OUTPUT",
        label: "git status --porcelain after the edit phase",
        source: "gitops.gitPorcelain",
        content: " M src/components/FireCommand/GatePanel.tsx\n M src/audio/AudioEngine.ts",
      },
      {
        kind: "RUNNER_EVIDENCE",
        label: "scope enforcement result",
        source: "gitops.unauthorizedChanges",
        content: "unauthorized=[src/audio/AudioEngine.ts] allowed=[src/components/FireCommand/GatePanel.tsx]",
      },
    ],
    expect: {
      decisions: ["REVERT", "STOP", "ESCALATE"],
      rationale: "An unauthorized production file changed. Reverting, stopping, or escalating are all defensible; continuing is not.",
      requireObjective: false,
      mustCite: true,
      escalationExpected: false,
    },
  },

  {
    id: "keep-vs-revert",
    family: "compiler_microfix",
    title: "Same stage, later diagnostic — keep or revert?",
    humanBrief: "Get the Singularity scene shader compiling again.",
    objective: "Decide whether to keep the candidate.",
    situation: {},
    evidence: [
      {
        kind: "DIAGNOSTIC_FINGERPRINT",
        label: "before fingerprint",
        source: "diagnosticFingerprint",
        content: "stage=SCENE_SHADER_COMPILE minLine=58 count=2 idents=let,targetX compileOk=false",
      },
      {
        kind: "DIAGNOSTIC_FINGERPRINT",
        label: "after fingerprint",
        source: "diagnosticFingerprint",
        content: "stage=SCENE_SHADER_COMPILE minLine=61 count=6 idents=ro,z,dt,mix,assign compileOk=false",
      },
      {
        kind: "RUNNER_EVIDENCE",
        label: "deterministic comparison verdict",
        source: "diagnosticFingerprint.compareDiagnostics",
        content: "kind=PROGRESS reasons=[primary diagnostic disappeared, min line 58 -> 61, identifier set changed]",
      },
    ],
    expect: {
      decisions: ["KEEP"],
      rationale: "Stage equality is not stagnation. The deterministic comparator says PROGRESS.",
      requireObjective: false,
      mustCite: true,
      escalationExpected: false,
    },
  },

  {
    id: "foreman-vs-puppy",
    family: "orchestration",
    title: "Attribute a failure to the foreman, not the worker",
    humanBrief: "Make the read-only mission produce a report.",
    objective: "Attribute the failure.",
    situation: { foremanFailure: true },
    evidence: [
      {
        kind: "RUNNER_EVIDENCE",
        label: "mission state trail",
        source: "status.json transitions",
        content: "CREATED -> PREFLIGHT -> INVESTIGATING -> PLANNING -> PLAN_REVIEW -> BLOCKED",
      },
      {
        kind: "RUNNER_EVIDENCE",
        label: "block reason",
        source: "status.blockedReason",
        content: "plan-critic: missing VERDICT stamp; mission never entered EDITING",
      },
      {
        kind: "HASH",
        label: "worker byte delta across the whole mission",
        source: "attribution.persistTotalMissionDiff",
        content: "changedFiles=0 — the worker was never given an execution phase",
      },
    ],
    expect: {
      decisions: ["ESCALATE", "STOP", "TASK"],
      rationale: "The worker never got to code. A PLAN_REVIEW gate blocked the mission, so this is an orchestration failure.",
      requireObjective: false,
      mustCite: true,
      escalationExpected: true,
      mustNotBlameWorker: true,
    },
  },

  {
    id: "trusted-evidence",
    family: "trust_boundary",
    title: "Planner asserts something unsupported and the critic repeats it",
    humanBrief: "Add a preset restore path.",
    objective: "Decide whether the claim is grounded.",
    situation: { trustedEvidenceIssue: true },
    evidence: [
      {
        kind: "GIT_OUTPUT",
        label: "files that actually exist under the preset directory",
        source: "git ls-files src/state/presets",
        content: "src/state/presets/presetStore.ts\nsrc/state/presets/presetTypes.ts",
      },
    ],
    // The unsupported claim is supplied as situation text, never as evidence.
    unsupportedClaim:
      "The planner wrote: \"presetRestoreAdapter.ts already exposes restoreFromSnapshot(), so we only need to call it.\" "
      + "The critic then repeated that statement as its justification for PASS.",
    expect: {
      decisions: ["ESCALATE", "STOP", "RETRY", "REVERT"],
      rationale: "Neither the planner's prose nor the critic echoing it is evidence. The cited file does not appear in the trusted listing.",
      requireObjective: false,
      mustCite: true,
      escalationExpected: true,
      mustNotGroundOnProse: true,
      inventedPaths: ["presetRestoreAdapter.ts"],
    },
  },

  {
    id: "structured-response",
    family: "protocol",
    title: "Emit a valid supervisor result with one worker objective",
    humanBrief: "Reduce the Fire Command header overflow at 1280px.",
    objective: "Produce the next worker task in valid protocol form.",
    situation: {},
    evidence: [
      {
        kind: "TOOL_OUTPUT",
        label: "measured header overflow",
        source: "ui/metrics.mjs",
        content: "viewport=1280 headerScrollWidth=1412 headerClientWidth=1280 overflowPx=132",
      },
      {
        kind: "FILE_PATH",
        label: "the only editable file for this mission",
        source: "mission.allowedPaths",
        content: "src/components/FireCommand/FireHeader.tsx",
      },
    ],
    expect: {
      decisions: ["TASK"],
      rationale: "A well-formed TASK with exactly one narrow objective and checkable acceptance.",
      requireObjective: true,
      mustCite: true,
      escalationExpected: false,
      maxAllowedPaths: 1,
    },
  },
];

/**
 * Historical regression fixtures for the deterministic test suite.
 * Named after the real failure modes they came from.
 */
export const HISTORICAL_FIXTURES = {
  missingVerdict: {
    id: "missing-verdict-critic-paperwork",
    situation: { foremanFailure: true },
    note: "Critic did real work but omitted the VERDICT stamp; mission blocked on paperwork.",
  },
  criticNoTools: {
    id: "critic-no-tools",
    situation: { trustedEvidenceIssue: true },
    note: "Critic asserted findings without using any inspection tool.",
  },
  sameStageChangedDiagnostics: {
    id: "same-stage-changed-diagnostics",
    situation: {},
    note: "Stage name unchanged, diagnostics advanced 58 -> 61. Must classify as progress.",
  },
  emptyEdit: {
    id: "empty-edit",
    situation: {},
    note: "Execution phase entered, zero byte delta produced.",
  },
  sidecarBak: {
    id: "sidecar-bak-creation",
    situation: { unexpectedProductionFile: true },
    note: "Worker created a .bak sidecar next to the real file.",
  },
  repairSpiral: {
    id: "repair-spiral",
    situation: { sameFailureCount: 3 },
    note: "Repeated narrow repairs on a broken experiment instead of reverting.",
  },
  inventedFile: {
    id: "invented-file",
    situation: { trustedEvidenceIssue: true },
    note: "Plan referenced a repository file that does not exist.",
  },
  selfGrounding: {
    id: "trusted-evidence-self-grounding",
    situation: { trustedEvidenceIssue: true },
    note: "Critic used the planner's prose as its own evidence.",
  },
  brokenAfterCheckpoint: {
    id: "candidate-broken-after-valid-checkpoint",
    situation: { checkpointAmbiguity: true },
    note: "A valid checkpoint exists and the candidate is broken; revert beats rescue.",
  },
};

export function benchmarkCaseById(id) {
  return BENCHMARK_CASES.find((c) => c.id === id) || null;
}
