---
{
  "id": "measure-live-readonly-overnight",
  "title": "Read-only map of measureLive callers",
  "goal": "Map src/lib/tractorLive.ts measureLive and every measureLive( call. Note live taps / finally. Read-only. Do not edit Tractor, AudioEngine, or DSP.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/lib/tractorLive.ts"
  ],
  "forbiddenPaths": [
    "src/audio/AudioEngine.ts",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "INSPECTED: src/lib/tractorLive.ts",
    "List measureLive( call sites",
    "Whether taps disconnect in finally",
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

# measureLive (read-only)

Do not modify Tractor DSP. Quote `export async function measureLive` and every `measureLive(` call. Note preTap/destinationTap connect/disconnect if present. End with VERDICT: READY or NOT_READY.
