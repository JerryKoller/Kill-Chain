---
{
  "id": "persistence-report-readonly-overnight",
  "title": "Read-only map of reportStorageFailure vs localStorage.setItem",
  "goal": "Map src/lib/storage.ts reportStorageFailure and whether localStorage.setItem sites call it. Read-only. Do not change persistence format or production stores.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/lib/storage.ts"
  ],
  "forbiddenPaths": [
    "src/audio/AudioEngine.ts",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "INSPECTED: src/lib/storage.ts",
    "Quote reportStorageFailure",
    "Same-file heuristic is not a production edit",
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

# reportStorageFailure (read-only)

Quote `reportStorageFailure`. Do not add try/catch to stores. Do not change persistence format. End with VERDICT: READY or NOT_READY.
