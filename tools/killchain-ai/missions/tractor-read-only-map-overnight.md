---
{
  "id": "tractor-read-only-map-overnight",
  "title": "Read-only Tractor Beam architecture map",
  "goal": "Map Tractor Beam UI + store + live-analyze files. Identify callers of tractor live taps and whether Mission State owns source-change automation. Read-only. No production edits. No AudioEngine/DSP behavior changes.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/components/Tractor/**",
    "src/lib/tractorLive.ts",
    "src/lib/tractorAutoLock.ts",
    "src/state/missionStateStore.ts"
  ],
  "forbiddenPaths": [
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "Existing file list with callers",
    "Tap connect/disconnect evidence",
    "Mission State vs tractor timer ownership",
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

# Tractor Beam read-only map

Do not edit production. Do not propose DSP curve changes. Cite MCP callers.
