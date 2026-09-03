---
{
  "id": "ui-store-readonly-overnight",
  "title": "Read-only map of uiStore",
  "goal": "Map src/state/uiStore.ts: exports, persistence, callers, whether any action calls AudioEngine/getEngine/claimSource or fire sequencer timing. Read-only. Not a Level 2B go-ahead.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/state/uiStore.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "List actions and persistence keys",
    "MCP callers sample",
    "Engine/claimSource/sequencer timing answers",
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

# uiStore map (read-only)

Do not edit uiStore. Do not start Level 2B.
