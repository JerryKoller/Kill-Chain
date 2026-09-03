---
{
  "id": "visual-intel-readonly-overnight",
  "title": "Read-only map of visualIntel destinationTap start/stop",
  "goal": "Map src/components/Visualizer/visualIntel.ts destinationTap connects and whether disconnect is start/stop refcount rather than finally. Read-only. Do not edit the visualizer or AudioEngine.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/components/Visualizer/visualIntel.ts"
  ],
  "forbiddenPaths": [
    "src/audio/AudioEngine.ts",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "INSPECTED: src/components/Visualizer/visualIntel.ts",
    "destinationTap.connect yes/no",
    "disconnect in start/stop vs finally",
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

# visualIntel taps (read-only)

Quote start() connect and the matching disconnect. Note if it uses ref-counting instead of finally. Do not edit production. End with VERDICT: READY or NOT_READY.
