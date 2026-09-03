---
{
  "id": "lock-library-readonly-overnight",
  "title": "Read-only map of lockLibraryStore",
  "goal": "Map src/state/lockLibraryStore.ts: Tractor lock library vs live Tractor/AudioEngine. Read-only. No production edits. Do not change Tractor or rewireFront.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/state/lockLibraryStore.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "What a lock record is",
    "Whether this store applies locks to the engine or only stores them",
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

# lockLibraryStore (read-only)

Tractor lock library is audio-adjacent even if this file has no getEngine. Do not apply locks in this mission.
