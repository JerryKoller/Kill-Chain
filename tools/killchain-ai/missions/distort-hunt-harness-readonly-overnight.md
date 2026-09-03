---
{
  "id": "distort-hunt-harness-readonly-overnight",
  "title": "Read-only map of fire-distort-hunt harness",
  "goal": "Read scripts/fire-distort-hunt.mjs: what it asserts, whether it touches AudioEngine production, whether it calls stopMissionState. Read-only. Do not edit scripts or DSP.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "scripts/fire-distort-hunt.mjs"
  ],
  "forbiddenPaths": [
    "src/audio/AudioEngine.ts",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "INSPECTED: scripts/fire-distort-hunt.mjs",
    "What it measures",
    "stopMissionState yes/no",
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

# distort-hunt harness (read-only)

Do not run a long hunt if the script would play audio for many minutes. Read the file. Quote what it asserts. Do not edit. End with VERDICT: READY or NOT_READY.
