---
{
  "id": "init-stop-mission-state-readonly-overnight",
  "title": "Read-only map of initMissionState and stopMissionState callers",
  "goal": "Map who calls initMissionState and stopMissionState. Read-only. Do not add callers. Do not edit Mission State.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/state/missionStateStore.ts",
    "src/App.tsx"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "INSPECTED: src/state/missionStateStore.ts",
    "Who calls initMissionState(",
    "Who calls stopMissionState(",
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

# init/stop Mission State (read-only)

Quote both exports. List every `initMissionState(` and `stopMissionState(` in `src/`. If stop has zero callers, say so — do not add one. Do not edit production. End with VERDICT: READY or NOT_READY.
