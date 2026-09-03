---
{
  "id": "cover-store-readonly-overnight-2",
  "title": "Read-only map of coverStore (retry)",
  "goal": "Map src/state/coverStore.ts: LRU object-URL album-art cache vs AudioEngine. Read-only. No production edits.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/state/coverStore.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "INSPECTED: src/state/coverStore.ts",
    "getEngine yes/no in this file",
    "What the LRU cache owns",
    "Map-only READY if evidence-backed",
    "No production edits",
    "VERDICT: READY or NOT_READY"
  ],
  "validation": { "required": [], "optional": [] },
  "maxPhases": 6,
  "maxRetriesPerPhase": 2,
  "maxWallClockMs": 1800000,
  "maxModelCalls": 20,
  "sessionTimeoutMs": 720000,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale"
}
---

# coverStore retry (read-only)

Previous run exhausted maxModelCalls. This file is short. Read it. End with:

VERDICT: READY

or

VERDICT: NOT_READY

Do not edit production. Do not parse covers in this mission.
