---
{
  "id": "fire-level3-overnight-dryrun",
  "title": "LEVEL 3 dry-run: substantial Fire Command feature plan (read-only)",
  "goal": "Discover and plan a coherent future feature spanning approximately 5–10 existing files (UI + state + helpers) that does not touch AudioEngine/DSP/sourceArbiter/rewireFront/Mission State/sequencer timing/persistence format. Read-only. Do not edit production.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/components/FireCommand/**",
    "src/state/fireCommandStore.ts",
    "src/state/fireSequencerStore.ts",
    "src/state/uiStore.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "src/lib/sourceArbiter.ts",
    "package.json"
  ],
  "acceptance": [
    "Architecture map with callers/callees",
    "Exact existing file list (about 5–10)",
    "Phased plan and acceptance criteria",
    "Risks, validation matrix, proposed checkpoints",
    "State ownership named",
    "Explicit audio boundary: no AudioEngine/DSP",
    "Final critic READY or NOT_READY with evidence",
    "No production edits",
    "Do not present Option A/B/C for the operator"
  ],
  "validation": { "required": [], "optional": [] },
  "maxPhases": 6,
  "maxRetriesPerPhase": 2,
  "maxWallClockMs": 5400000,
  "maxModelCalls": 24,
  "sessionTimeoutMs": 720000,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale"
}
---

# LEVEL 3 dry-run (overnight)

READ-ONLY endurance planning. No production edits. Cursor must not author the feature.

Do not plan Gate/Macro overflow, ModuleEnableToggle contrast, or drum-fill preview (already attempted).

Required artifacts in the visible reports: architecture map, callers/callees, exact file list, phases, acceptance, risks, validation matrix, checkpoints, state ownership, audio boundary, critic.
