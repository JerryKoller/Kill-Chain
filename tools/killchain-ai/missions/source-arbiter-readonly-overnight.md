---
{
  "id": "source-arbiter-readonly-overnight",
  "title": "Read-only map of claimSource / sourceArbiter",
  "goal": "Map src/lib/sourceArbiter.ts claimSource cases and what each source silences. Read-only. Do not edit claimSource, AudioEngine, or playback stores.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/lib/sourceArbiter.ts"
  ],
  "forbiddenPaths": [
    "src/audio/AudioEngine.ts",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "INSPECTED: src/lib/sourceArbiter.ts",
    "Quote claimSource switch cases",
    "What file/fire/loopback/airspace each stop",
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

# sourceArbiter (read-only)

Quote `export function claimSource` and the four cases. Do not change ownership rules. Do not edit production. End with VERDICT: READY or NOT_READY.
