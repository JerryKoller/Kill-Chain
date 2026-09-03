---
{
  "id": "visualizer-store-readonly-overnight",
  "title": "Read-only map of visualizerStore",
  "goal": "Map src/state/visualizerStore.ts: mode persistence, callers, whether it constructs AnalyserNode or calls getEngine. Read-only. No production edits. Do not add FFT pipelines.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/state/visualizerStore.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "What the store owns",
    "AnalyserNode / getEngine yes/no",
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

# visualizerStore (read-only)

One-high-rate-FFT invariant: do not propose extra analysers. READY means the map is complete.
