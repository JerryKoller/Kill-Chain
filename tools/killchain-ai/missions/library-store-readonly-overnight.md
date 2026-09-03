---
{
  "id": "library-store-readonly-overnight",
  "title": "Read-only map of libraryStore",
  "goal": "Map src/state/libraryStore.ts: persistence, callers, whether play/load calls getEngine or claimSource (directly or via playerStore). Read-only. No production edits.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/state/libraryStore.ts",
    "src/state/playerStore.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "What libraryStore owns vs playerStore",
    "Engine/claimSource path if play is involved",
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

# libraryStore (read-only)

READY means the map is complete. Playing a library track is not a Fire Command Level 2 mission.
