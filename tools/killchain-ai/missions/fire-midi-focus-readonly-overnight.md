---
{
  "id": "fire-midi-focus-readonly-overnight",
  "title": "Read-only map of fireMidiFocusStore",
  "goal": "Map src/state/fireMidiFocusStore.ts: exports, UI callers, whether it calls AudioEngine/getEngine/claimSource, whether it persists, whether it runs during playback. Read-only. No production edits. This is not permission to run Level 2B.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/state/fireMidiFocusStore.ts",
    "src/components/FireCommand/**"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "MCP callers of the store",
    "Engine/claimSource/persist/playback answers",
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

# fireMidiFocusStore map (read-only)

Use MCP callers. Do not edit the store or UI.
Do not treat a clean map as a live Level 2B go-ahead.
