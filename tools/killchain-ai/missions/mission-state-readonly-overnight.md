---
{
  "id": "mission-state-readonly-overnight",
  "title": "Read-only map of missionStateStore orchestrator",
  "goal": "Map src/state/missionStateStore.ts as the sole source-change automation orchestrator. Prove initMissionState, stopMissionState, settle pipeline, manual hold, and audioStore/eqStore watches from source. Read-only. No production edits. Do not change Mission State behavior.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/state/missionStateStore.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "INSPECTED: src/state/missionStateStore.ts",
    "Quote initMissionState and stopMissionState if they exist",
    "Whether this file imports AudioEngine or only audioStore/eqStore",
    "Timers: poll vs settle vs cleanup",
    "Map-only READY if evidence-backed",
    "No production edits",
    "VERDICT: READY or NOT_READY"
  ],
  "validation": { "required": [], "optional": [] },
  "maxPhases": 6,
  "maxRetriesPerPhase": 2,
  "maxWallClockMs": 1800000,
  "maxModelCalls": 16,
  "sessionTimeoutMs": 720000,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale"
}
---

# missionStateStore (read-only)

MISSION STATE is a hard audio invariant. Inspect the file. Quote `initMissionState` and `stopMissionState` from source — do not claim a symbol is missing if the file exports it. Do not edit production. Do not propose Mission State behavior changes.
