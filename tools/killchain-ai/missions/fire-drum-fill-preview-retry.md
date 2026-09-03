---
{
  "id": "fire-drum-fill-preview-retry",
  "title": "Drum fill preview presentation (retry LEVEL 2)",
  "goal": "Resolve the Drum Bay fill-preview pending vs committed UI ambiguity with a presentation-only change. Fresh investigation of current source. Do not reuse the previous broken JSX. No store/audio/timing/persistence changes.",
  "level": 2,
  "allowedPaths": [
    "src/components/FireCommand/DrumMachine.tsx",
    "src/components/FireCommand/PatternSelect.tsx",
    "src/components/FireCommand/SequencerPanel.tsx"
  ],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/components/FireCommand/PianoRoll.tsx",
    "src/components/FireCommand/FireTransportDock.tsx",
    "src/state/fireSequencerStore.ts",
    "src/state/fireCommandStore.ts",
    "src/state/**"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "src/state/**",
    "electron/**",
    "src/lib/sourceArbiter.ts",
    "src/audio/AudioEngine.ts",
    "package.json"
  ],
  "acceptance": [
    "Presentation-only: pending vs committed fill preview is glanceable without changing store semantics",
    "Existing generateDrumFill / acceptDrumFillPreview / revertDrumFillPreview / setDrumFillAuto signatures unchanged",
    "No invented callbacks; existing handler signatures preserved",
    "No fireSequencerStore.ts / AudioEngine / DSP / persistence-format / sequencer timing edits",
    "PatternSelect may only change presentation around existing setActiveSection usage",
    "If investigation shows PatternSelect or SequencerPanel is unnecessary, do not edit it",
    "TSX must be mechanically valid after each logical edit",
    "Typecheck passes",
    "Build passes",
    "Diff contains only authorized files that were actually justified",
    "Do not touch parked Gate/Macro/fireUiKit/ModuleEnableToggle",
    "Human visual review remains required; do not commit"
  ],
  "validation": {
    "required": ["typecheck", "build"],
    "optional": [],
    "restoreTsbuildinfo": true
  },
  "maxPhases": 3,
  "maxRetriesPerPhase": 3,
  "maxWallClockMs": 5400000,
  "maxModelCalls": 36,
  "sessionTimeoutMs": 720000,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale",
  "diff": {
    "maxFiles": 3,
    "maxInsertions": 120,
    "warnOnly": true
  },
  "ux": {
    "workflow": "Drum fill preview: generate last-bar fill, see pending preview, Accept/Regenerate/Revert, optionally Auto, switch pattern",
    "visualCriteria": [
      "Pending fill preview is obvious at a glance in Drum Bay",
      "Committed vs pending is not the same faint treatment",
      "Auto-on-last-bar is findable without hunting only a right-click popover"
    ],
    "interactionCriteria": [
      "Accept / Regenerate / Revert still call the same store methods",
      "Pattern select still calls the existing handler"
    ],
    "manualReview": "Human checks Drum Bay fill preview at 1440/1366 after overnight. Typecheck/build is not visual proof."
  }
}
---

# Drum fill preview presentation (RETRY)

Previous mission `fire-drum-fill-preview-live` BLOCKED: empty first edits, then broken JSX, repair budget exhausted, lossless restore. This is a **fresh** live attempt from the restored application baseline.

Cursor/Composer must **not** edit application UI. Local Qwen investigates current source before proposing. Do not copy the previous broken bytes.

Parked dirty files (Gate/Macro/fireUiKit/ModuleEnableToggle) are **preserved**. Do not edit or revert them.

## Non-goals

Audio, DSP, MIDI, persistence format, AudioEngine, `src/state/**` writes, Gate/Macro overflow, ModuleEnableToggle, global FcChip truncation, PianoRoll fill chrome.
