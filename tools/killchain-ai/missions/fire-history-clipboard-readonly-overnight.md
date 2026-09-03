---
{
  "id": "fire-history-clipboard-readonly-overnight",
  "title": "Read-only map of fireHistory and fireClipboard",
  "goal": "Map src/lib/fireHistory.ts and src/lib/fireClipboard.ts: callers, whether they call AudioEngine/getEngine, whether undo/redo is presentation-only. Read-only. No production edits.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/lib/fireHistory.ts",
    "src/lib/fireClipboard.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "Callers via MCP",
    "Engine coupling yes/no",
    "Map-only READY if evidence-backed",
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

# fireHistory / fireClipboard (read-only)

Do not edit history or clipboard. READY means the map is complete.
