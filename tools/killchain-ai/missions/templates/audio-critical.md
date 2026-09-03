---
{
  "id": "audio-critical-template",
  "title": "Audio-critical change (template — not auto-enabled)",
  "goal": "Replace. High-risk audio/DSP/routing work is not authorized by creating this file.",
  "level": 4,
  "allowAudioEdits": false,
  "allowedPaths": [],
  "readOnlyPaths": [
    "src/audio/AudioEngine.ts",
    "src/lib/sourceArbiter.ts",
    "src/state/missionStateStore.ts"
  ],
  "forbiddenPaths": [],
  "acceptance": [
    "Hard invariants remain intact",
    "One audible source preserved",
    "Store/engine pairing stays same-synchronous-action",
    "Live taps disconnected in finally",
    "Timers and rAF cleaned up",
    "Human approved the edit phase",
    "typecheck, build, and smoke pass",
    "Task-specific diagnostics pass when relevant"
  ],
  "validation": {
    "required": ["typecheck", "build", "smoke"],
    "optional": ["distort-hunt", "leak-check", "project-repro"],
    "restoreTsbuildinfo": true
  },
  "maxPhases": 4,
  "maxRetriesPerPhase": 2,
  "maxWallClockMs": 7200000,
  "maxModelCalls": 16,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale",
  "diff": {
    "maxFiles": 8,
    "maxInsertions": 200,
    "warnOnly": false
  },
  "audio": {
    "invariants": [
      "Only rewireFront() may mutate front routing gains",
      "Only claimSource() may decide playback ownership",
      "Only Mission State may react to source changes",
      "Live audio-tap nodes must be disconnected in finally",
      "Intervals and requestAnimationFrame must be cleaned up",
      "Store writes and matching AudioEngine calls must occur in the same synchronous action",
      "Preserve the one-audible-source rule"
    ],
    "humanApprovalBeforeEdit": true
  }
}
---

# Audio-critical mission (NOT permission to run edits)

This template prepares a **level 4** envelope. The runner will **BLOCK** before EDITING unless:

- `allowAudioEdits` is true, and
- the operator passes `--approve-audio-edit`

Do not copy this template onto a casual UI task.

## Required investigation (read-only until approved)

- `rewireFront` / front routing
- `claimSource` / source arbiter
- Mission State orchestration and priority: manual override > saved source memory > Auto-Lock > Auto-Flatten
- Same-synchronous-action store/AudioEngine pairing
- Live tap cleanup
- Timer / rAF cleanup

## Validation

Always: typecheck, build, smoke.
Add distort-hunt, leak-check, or project-repro when the change could affect Fire distortion, analysers, or project round-trip.

## Mandatory critic

Plan critic + final critic cannot be skipped at this level.

## Human stop

If the work would change DSP algorithms, EQ curves, gain staging, spatialization, or invariant order: BLOCK and wait.
