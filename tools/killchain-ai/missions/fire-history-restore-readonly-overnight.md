---
{
  "id": "fire-history-restore-readonly-overnight",
  "title": "Read-only map of fireHistory restore providers",
  "goal": "Read registerFireHistoryProvider restore callbacks in fireCommandStore.ts and fireSequencerStore.ts. Determine whether restore is presentation-only or also drives synth/ARP/sequencer state that later hits AudioEngine. Read-only. No production edits. Do not invent fireCommands/Panel.tsx.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/lib/fireHistory.ts",
    "src/state/fireCommandStore.ts",
    "src/state/fireSequencerStore.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "Quote restore callback behavior from the two registerFireHistoryProvider sites",
    "Say whether undo is presentation-only (it likely is not)",
    "No invented files",
    "Map-only READY if evidence-backed",
    "No production edits",
    "VERDICT: READY or NOT_READY"
  ],
  "validation": { "required": [], "optional": [] },
  "maxPhases": 6,
  "maxRetriesPerPhase": 2,
  "maxWallClockMs": 1800000,
  "maxModelCalls": 14,
  "sessionTimeoutMs": 720000,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale"
}
---

# fireHistory restore providers (read-only)

The previous map claimed undo/redo is presentation-only. The HistoryProvider type comment says restore applies snapshots onto the store + audio engine. Read the actual restore functions. Do not edit.
