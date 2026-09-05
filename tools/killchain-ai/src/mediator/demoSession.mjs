/**
 * Fixture-driven session.
 *
 * The first demo must not modify production, so the worker here is a scripted
 * replay of archived failure modes rather than a live mission. The supervisor
 * calls are real, the routing is real, the protocol validation is real, and the
 * Puppy animation follows the real demo state. Only the worker is simulated,
 * and every record it writes is tagged `simulated: true` so it can never be
 * mistaken for measured worker skill.
 */
import {
  OVERNIGHT_LET_LOG,
  OVERNIGHT_RO_DT_LOG,
  compareDiagnostics,
  diagnosticFingerprint,
} from "../overnight/diagnosticFingerprint.mjs";
import { DISPATCH_FIXTURE, MediatorSession } from "./session.mjs";

/**
 * Scripted worker outcomes.
 *
 * Chosen to exercise the whole chain: honest progress, a zero-delta claim, the
 * same failure twice (which must force DEEP), and finally a clean pass.
 */
export const DEMO_STEPS = [
  {
    id: "progress",
    family: "compiler_microfix",
    situationText:
      "Robo Puppy has not attempted anything yet. The scene shader fails to compile. "
      + "Decide the first narrow task.",
    evidence: () => [
      { kind: "COMPILER_OUTPUT", label: "current shader compile log", source: "SCENE_SHADER_COMPILE (archived fixture)", content: OVERNIGHT_LET_LOG },
      { kind: "FILE_PATH", label: "the only editable file for this fixture mission", source: "mission.allowedPaths", content: "tools/killchain-ai/data/mediator/sandbox/fixture-shader.glsl" },
    ],
    worker: () => {
      const before = diagnosticFingerprint({ stage: "SCENE_SHADER_COMPILE", log: OVERNIGHT_LET_LOG });
      const after = diagnosticFingerprint({ stage: "SCENE_SHADER_COMPILE", log: OVERNIGHT_RO_DT_LOG });
      const cmp = compareDiagnostics(before, after);
      return {
        summary: `Diagnostics advanced ${before.minLine} → ${after.minLine} (${cmp.kind}).`,
        byteDelta: 412,
        changedFiles: ["tools/killchain-ai/data/mediator/sandbox/fixture-shader.glsl"],
        workerCalls: 4,
        diagnosticBefore: before.signature,
        diagnosticAfter: after.signature,
        failureClass: null,
        outcome: "KEEP",
        checkpointDecision: "PRESERVE",
        validation: { typecheck: "not-run", note: "fixture replay — no real validation was executed" },
        validationMs: 0,
        family: "compiler_microfix",
        situation: {},
      };
    },
  },
  {
    id: "empty-edit",
    family: "empty_edit",
    situationText:
      "The previous attempt progressed. Robo Puppy then reported \"I fixed the remaining errors\", "
      + "but the phase byte delta is zero. Review that claim.",
    evidence: () => [
      { kind: "HASH", label: "phase byte delta from attribution fingerprints", source: "attribution.enforcePhaseDelta (archived fixture)", content: "changedFiles=0 dirty=[] byteDelta=0" },
      { kind: "GIT_OUTPUT", label: "git status --porcelain after the edit phase", source: "gitops.gitPorcelain (archived fixture)", content: "(no output — working tree unchanged)" },
      { kind: "RUNNER_EVIDENCE", label: "edit outcome classification", source: "editGate.classifyEditOutcome", content: "kind=EMPTY_EDIT empty=true mutationToolUsed=false emptyEditStreak=1" },
    ],
    worker: () => ({
      summary: "Retry also produced zero bytes. Same failure a second time.",
      byteDelta: 0,
      changedFiles: [],
      workerCalls: 5,
      failureClass: "APPLY_EMPTY",
      outcome: "RETRY",
      checkpointDecision: "HOLD",
      validation: null,
      validationMs: 0,
      family: "empty_edit",
      // Two identical failures is the deterministic trigger for deep supervision.
      situation: { sameFailureCount: 2 },
    }),
  },
  {
    id: "deep-resolution",
    family: "orchestration",
    situationText:
      "Robo Puppy has now produced a zero-byte edit twice in a row for the same objective. "
      + "Decide whether this is a worker failure or an orchestration failure, and what should happen next.",
    evidence: () => [
      { kind: "RUNNER_EVIDENCE", label: "mission state trail", source: "status.json transitions (archived fixture)", content: "PROPOSING -> EDITING -> DIFF_REVIEW -> EDITING -> DIFF_REVIEW (no VALIDATING reached)" },
      { kind: "HASH", label: "byte delta across both attempts", source: "attribution.persistTotalMissionDiff", content: "attempt1 byteDelta=0 attempt2 byteDelta=0" },
      { kind: "RUNNER_EVIDENCE", label: "expected files from the approved proposal", source: "runner expectedFiles", content: "expected=[fixture-shader.glsl] actual=[]" },
    ],
    worker: () => ({
      summary: "After deep supervision the objective was narrowed to a single function body; the worker applied it.",
      byteDelta: 188,
      changedFiles: ["tools/killchain-ai/data/mediator/sandbox/fixture-shader.glsl"],
      workerCalls: 3,
      failureClass: null,
      outcome: "KEEP",
      checkpointDecision: "PRESERVE",
      validation: { typecheck: "not-run", note: "fixture replay — no real validation was executed" },
      validationMs: 0,
      family: "compiler_microfix",
      situation: { sameFailureCount: 0 },
    }),
  },
  {
    id: "clean-pass",
    family: "compiler_microfix",
    situationText:
      "The narrowed change is in. The fixture compile log now reports success. Decide whether to keep it.",
    evidence: () => [
      { kind: "COMPILER_OUTPUT", label: "shader compile log after the narrowed change", source: "SCENE_SHADER_COMPILE (archived fixture)", content: "SCENE_SHADER_COMPILE_OK=true\n(no diagnostics)" },
      { kind: "DIAGNOSTIC_FINGERPRINT", label: "deterministic comparison verdict", source: "diagnosticFingerprint.compareDiagnostics", content: "kind=SUCCESS compileOk=true" },
    ],
    worker: () => ({
      summary: "Fixture compile succeeded. Nothing further to attempt.",
      byteDelta: 0,
      changedFiles: [],
      workerCalls: 0,
      failureClass: null,
      outcome: "KEEP",
      checkpointDecision: "PRESERVE",
      validation: { typecheck: "not-run", note: "fixture replay — no real validation was executed" },
      validationMs: 0,
      family: "compiler_microfix",
      situation: {},
      final: true,
    }),
  },
];

export class DemoMediatorSession extends MediatorSession {
  constructor(opts = {}) {
    super({ ...opts, dispatch: DISPATCH_FIXTURE });
    this.stepIndex = 0;
    this.spec = {
      id: "mediator-fixture-demo",
      level: 1,
      allowedPaths: ["tools/killchain-ai/data/mediator/sandbox/**"],
      forbiddenPaths: ["src/**", "electron/**"],
    };
  }

  currentStep() {
    return DEMO_STEPS[Math.min(this.stepIndex, DEMO_STEPS.length - 1)];
  }

  async gatherEvidence() {
    const step = this.currentStep();
    return { family: step.family, situationText: step.situationText, items: step.evidence() };
  }

  async runWorker() {
    const step = this.currentStep();
    const result = step.worker();
    this.stepIndex += 1;
    if (result.final || this.stepIndex >= DEMO_STEPS.length) {
      this.maxTasks = Math.min(this.maxTasks, this.taskCount);
    }
    // A short, real delay so the console's wake/work animation is observable
    // rather than flashing past. This is presentation timing, not fake activity.
    await new Promise((r) => setTimeout(r, 900));
    return result;
  }
}
