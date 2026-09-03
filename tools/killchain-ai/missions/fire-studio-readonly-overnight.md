---
{
  "id": "fire-studio-readonly-overnight",
  "title": "Read-only map of fireStudio bounce/export taps",
  "goal": "Map src/lib/fireStudio.ts: live taps, finally disconnect, AudioEngine use. Read-only. Do not edit Fire Studio, bounce, or AudioEngine.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/lib/fireStudio.ts"
  ],
  "forbiddenPaths": [
    "src/audio/AudioEngine.ts",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "INSPECTED: src/lib/fireStudio.ts",
    "getEngine / tap / finally yes/no",
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

# fireStudio (read-only)

Quote getEngine, tap connect, and finally disconnect if present. Do not bounce audio in this mission. Do not edit production. End with VERDICT: READY or NOT_READY.
