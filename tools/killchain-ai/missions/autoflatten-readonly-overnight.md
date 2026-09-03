---
{
  "id": "autoflatten-readonly-overnight",
  "title": "Read-only map of autoFlatten callers",
  "goal": "Map src/audio/AutoFlatten.ts definition and every autoFlatten( call site. Confirm Mission State is the production caller. Read-only. Do not edit AutoFlatten, AudioEngine, or Mission State.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/audio/AutoFlatten.ts",
    "src/state/missionStateStore.ts"
  ],
  "forbiddenPaths": [
    "src/audio/AudioEngine.ts",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "INSPECTED: src/audio/AutoFlatten.ts",
    "INSPECTED: src/state/missionStateStore.ts",
    "List autoFlatten( call sites",
    "Whether extra callers besides Mission State exist",
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

# autoFlatten (read-only)

Do not modify DSP. Quote `export async function autoFlatten` and every `autoFlatten(` call. Settings `autoFlatten` boolean is not a call site. End with VERDICT: READY or NOT_READY.
