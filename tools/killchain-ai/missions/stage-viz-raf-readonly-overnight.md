---
{
  "id": "stage-viz-raf-readonly-overnight",
  "title": "Read-only map of Fire Command stage viz RAF cleanup",
  "goal": "Map src/components/FireCommand/useStageCanvas.ts and stageVizRaf.ts: requestAnimationFrame vs cancel. Read-only. No production edits. Do not change visualizers.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/components/FireCommand/useStageCanvas.ts",
    "src/components/FireCommand/stageVizRaf.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "INSPECTED: src/components/FireCommand/useStageCanvas.ts",
    "INSPECTED: src/components/FireCommand/stageVizRaf.ts",
    "Whether rAF is cancelled on cleanup",
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

# stage viz RAF (read-only)

Quote requestAnimationFrame / cancelAnimationFrame pairing from these two files. Do not edit visualizers. End with VERDICT: READY or NOT_READY.
