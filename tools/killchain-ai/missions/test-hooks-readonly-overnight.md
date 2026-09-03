---
{
  "id": "test-hooks-readonly-overnight",
  "title": "Read-only map of __KC_TEST hooks",
  "goal": "Map src/lib/testHooks.ts: what __KC_TEST exposes, whether it can mutate AudioEngine. Read-only. Do not edit test hooks or production audio.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/lib/testHooks.ts"
  ],
  "forbiddenPaths": [
    "src/audio/AudioEngine.ts",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "INSPECTED: src/lib/testHooks.ts",
    "What __KC_TEST.load returns",
    "Whether this is production-gated",
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

# __KC_TEST (read-only)

Quote the hook. Note if it is DEV-only. Do not widen the hook. Do not edit production. End with VERDICT: READY or NOT_READY.
