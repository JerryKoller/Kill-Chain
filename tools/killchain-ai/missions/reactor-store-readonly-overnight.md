---
{
  "id": "reactor-store-readonly-overnight",
  "title": "Read-only map of reactorStore",
  "goal": "Map src/state/reactorStore.ts: pad intensities vs audioStore/AudioEngine. Read-only. No production edits. Do not change Reactor DSP.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/state/reactorStore.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "INSPECTED: src/state/reactorStore.ts",
    "Whether tick/pads call audioStore or getEngine",
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

# reactorStore (read-only)

Qwen previously said reactorStore has no engine import but bridges via useAudioStore in tick(). Prove it from source. Do not edit.
