---
{
  "id": "restore-analyze-readonly-overnight",
  "title": "Read-only map of restoreAnalyze preTap disconnect",
  "goal": "Map src/lib/restoreAnalyze.ts analyzeForRestore: preTap connects, finally disconnect. Read-only. Do not analyze audio or edit DSP.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/lib/restoreAnalyze.ts"
  ],
  "forbiddenPaths": [
    "src/audio/AudioEngine.ts",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "INSPECTED: src/lib/restoreAnalyze.ts",
    "preTap connect yes/no",
    "finally disconnect yes/no",
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

# restoreAnalyze (read-only)

Quote preTap.connect and the finally disconnect. Do not run analysis. Do not edit production. End with VERDICT: READY or NOT_READY.
