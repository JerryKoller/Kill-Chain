---
{
  "id": "settings-store-readonly-overnight",
  "title": "Read-only map of settingsStore",
  "goal": "Map src/state/settingsStore.ts: persisted keys, callers, AudioEngine/claimSource/sequencer coupling if any. Read-only. No production edits. Not Level 2B.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/state/settingsStore.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "Persistence keys and reportStorageFailure if any",
    "MCP callers sample",
    "Engine coupling yes/no",
    "No invented files",
    "Map-only READY if evidence-backed (later edits remaining unauthorized is not a reason for NOT_READY)",
    "No production edits",
    "VERDICT: READY or NOT_READY"
  ],
  "validation": { "required": [], "optional": [] },
  "maxPhases": 6,
  "maxRetriesPerPhase": 2,
  "maxWallClockMs": 1800000,
  "maxModelCalls": 14,
  "sessionTimeoutMs": 720000,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale"
}
---

# settingsStore map (read-only)

READY means the map is complete. Do not NOT_READY only because you may not edit later.
