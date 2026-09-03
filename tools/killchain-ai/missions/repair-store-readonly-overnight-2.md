---
{
  "id": "repair-store-readonly-overnight-2",
  "title": "Read-only map of repairStore (retry)",
  "goal": "Map src/state/repairStore.ts: session-only Restoration Bay UI glue vs Reconstructor/AudioEngine. Read-only. No production edits. Do not enable repair DSP.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/state/repairStore.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "INSPECTED: src/state/repairStore.ts",
    "Whether this file calls getEngine or Reconstructor",
    "Known UI callers if found",
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

# repairStore retry (read-only)

Previous critic omitted `INSPECTED: src/...` and was blocked. This pass must include the line:

INSPECTED: src/state/repairStore.ts

Read that file. It is short. Quote whether it imports AudioEngine. Do not edit production. Restoration Bay DSP stays untouched.
