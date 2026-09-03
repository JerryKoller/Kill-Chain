---
{
  "id": "store-engine-coupling-overnight",
  "title": "Read-only map of src/state files that call AudioEngine",
  "goal": "List every src/state file that imports AudioEngine or calls getEngine/activeFireEngine. For each, note whether pairing with engine calls is synchronous. Read-only. No production edits. Do not propose AudioEngine/DSP/rewireFront/claimSource changes.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/state/**",
    "src/audio/AudioEngine.ts"
  ],
  "forbiddenPaths": [
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "MCP-first investigate",
    "Table of store files vs getEngine/activeFireEngine",
    "Call out any store that is presentation-only (no engine import) if found",
    "No production edits",
    "VERDICT: READY or NOT_READY"
  ],
  "validation": { "required": [], "optional": [] },
  "maxPhases": 6,
  "maxRetriesPerPhase": 2,
  "maxWallClockMs": 2400000,
  "maxModelCalls": 16,
  "sessionTimeoutMs": 720000,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale"
}
---

# Store ↔ AudioEngine coupling map (read-only)

Use MCP search/callers for `getEngine` and `activeFireEngine`.
Do not edit stores. Do not edit AudioEngine.
This is evidence for whether a future Level 2B isolated UI-state action exists — not permission to run Level 2B.
