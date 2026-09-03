---
{
  "id": "mission-log-readonly-overnight",
  "title": "Read-only map of missionLogStore",
  "goal": "Map src/state/missionLogStore.ts vs missionStateStore.ts: what the log records, persistence, whether it orchestrates source-change automation. Read-only. No production edits. Do not change Mission State.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/state/missionLogStore.ts",
    "src/state/missionStateStore.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "Log vs orchestrator distinction",
    "Engine/claimSource yes/no",
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

# missionLog vs MISSION STATE (read-only)

Invariant: missionStateStore is the sole source-change automation orchestrator. The log must not be treated as that. Do not edit either store.
