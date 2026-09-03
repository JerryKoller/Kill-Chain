---
{
  "id": "seq-chrome-readonly-overnight",
  "title": "Read-only sequencer chrome file map",
  "goal": "Map seqChrome.tsx, PatternItem.tsx, PatternSelect.tsx, SequencerPanel.tsx import relationships. Identify whether any presentation-only chrome change could stay out of fireSequencerStore and AudioEngine. Read-only. Not drum-fill preview. No production edits.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/components/FireCommand/seqChrome.tsx",
    "src/components/FireCommand/PatternItem.tsx",
    "src/components/FireCommand/PatternSelect.tsx",
    "src/components/FireCommand/SequencerPanel.tsx",
    "src/components/FireCommand/DrumMachine.tsx"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "src/state/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "Import graph among the listed files",
    "Which files write sequencer store vs chrome-only",
    "Do not propose drum-fill preview work",
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

# Sequencer chrome map (read-only)

Drum-fill preview already BLOCKED twice. Do not revive it.
Map chrome vs store coupling only.
