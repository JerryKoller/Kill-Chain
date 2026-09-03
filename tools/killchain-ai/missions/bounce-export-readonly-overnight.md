---
{
  "id": "bounce-export-readonly-overnight",
  "title": "Read-only map of Library bounceExport destinationTap",
  "goal": "Map src/lib/bounceExport.ts captureProcessedPass: destinationTap ScriptProcessor, finally disconnect, player seek/play restore. Read-only. Do not bounce audio or edit AudioEngine.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/lib/bounceExport.ts"
  ],
  "forbiddenPaths": [
    "src/audio/AudioEngine.ts",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "INSPECTED: src/lib/bounceExport.ts",
    "destinationTap connect/disconnect yes/no",
    "finally yes/no",
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

# bounceExport (read-only)

Quote `captureProcessedPass` tap connect and finally disconnect. Do not run a bounce. Do not edit production. End with VERDICT: READY or NOT_READY.
