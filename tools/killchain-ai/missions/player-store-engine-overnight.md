---
{
  "id": "player-store-engine-overnight",
  "title": "Read-only playerStore getEngine map",
  "goal": "Map every getEngine() call in src/state/playerStore.ts: action name, whether store write and engine call are in the same synchronous function, whether claimSource is involved. Read-only. No production edits.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/state/playerStore.ts",
    "src/lib/sourceArbiter.ts",
    "src/audio/AudioEngine.ts"
  ],
  "forbiddenPaths": [
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "MCP-first",
    "List getEngine call sites with enclosing function names",
    "Note claimSource relationship if any",
    "No production edits",
    "VERDICT: READY or NOT_READY"
  ],
  "validation": { "required": [], "optional": [] },
  "maxPhases": 6,
  "maxRetriesPerPhase": 2,
  "maxWallClockMs": 2400000,
  "maxModelCalls": 14,
  "sessionTimeoutMs": 720000,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale"
}
---

# playerStore ↔ engine (read-only)

The store-engine coupling mission omitted playerStore. Fill that gap with MCP callers and file reads.
Do not edit playerStore, AudioEngine, or claimSource.
