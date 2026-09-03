---
{
  "id": "custom-headphones-readonly-overnight",
  "title": "Read-only map of customHeadphonesStore",
  "goal": "Map src/state/customHeadphonesStore.ts. Final critic MUST include a line INSPECTED: src/state/customHeadphonesStore.ts. Read-only. No production edits. Do not change headphone DSP.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/state/customHeadphonesStore.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "First critic line: INSPECTED: src/state/customHeadphonesStore.ts",
    "What it stores",
    "getEngine yes/no",
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

# customHeadphonesStore (read-only)

Write INSPECTED: with the real src/ path. READY means the map is complete.
