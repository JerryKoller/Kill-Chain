---
{
  "id": "leak-check-harness-readonly-overnight",
  "title": "Read-only map of fire-leak-check harness vs Mission State",
  "goal": "Read scripts/fire-leak-check.mjs and scripts/smoke.mjs: do they call stopMissionState or claimSource? Read-only. Do not edit scripts or production.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "scripts/fire-leak-check.mjs",
    "scripts/smoke.mjs",
    "scripts/smoke-page.js"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "INSPECTED: scripts/fire-leak-check.mjs",
    "INSPECTED: scripts/smoke.mjs",
    "INSPECTED: scripts/smoke-page.js if it exists",
    "Whether stopMissionState is invoked",
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

# leak-check / smoke (read-only)

Quote whether these scripts call `stopMissionState`. Do not add the call. Do not edit scripts. End with VERDICT: READY or NOT_READY.
