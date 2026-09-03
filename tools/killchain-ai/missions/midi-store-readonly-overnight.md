---
{
  "id": "midi-store-readonly-overnight",
  "title": "Read-only map of midiStore",
  "goal": "Map src/state/midiStore.ts: mappings vs live MIDI path including fireMidiFocusStore and claimSource. Read-only. No production edits. Do not change MIDI or AudioEngine.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/state/midiStore.ts",
    "src/state/fireMidiFocusStore.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "INSPECTED: must include src/state/midiStore.ts",
    "Live MIDI vs persisted mappings",
    "fireMidiFocus / claimSource if any",
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

# midiStore (read-only)

MIDI is high-rate and playback-adjacent. Do not edit mappings or the MIDI handler.
First critic line should include INSPECTED: src/state/midiStore.ts
