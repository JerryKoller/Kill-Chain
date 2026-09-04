---
{
  "id": "fire-drum-fill-preview-live",
  "title": "Drum fill preview presentation (live LEVEL 2)",
  "goal": "Make the existing Drum Bay fill-preview workflow glanceable: pending vs committed, pattern-switch context, and the already-wired Auto checkbox — presentation only, no store signature or audio changes.",
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
    "src/state/fireCommandStore.ts"
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
    "Fill-preview pending state is visually stronger than 9px dashed amber copy that can be missed",
    "Accept vs Revert vs Regenerate remain distinct; do not merge them into one control",
    "Existing generateDrumFill / acceptDrumFillPreview / revertDrumFillPreview / setDrumFillAuto call sites keep the same signatures",
    "drumFillAuto checkbox may be made more visible using the existing setter — do not add store fields",
    "Pattern switch (PatternSelect) does not silently look like the fill is still pending if the preview banner vanished",
    "No fireSequencerStore.ts / AudioEngine / persistence-format edits",
    "Do not restyle the whole sequencer; do not touch Gate/Macro/ModuleEnableToggle/fireUiKit",
    "PianoRoll.tsx has no generateDrumFill callers — inspect only, do not invent piano-roll fill chrome",
    "Keyboard/focus on Fill last bar, Accept, pattern select remain usable",
    "Typecheck passes",
    "Build passes",
    "Diff contains only the three authorized files",
    "A later EDITING/REPAIRING phase may revise the same already-dirty mission-owned files",
    "Human visual review remains required"
  ],
  "validation": {
    "required": ["typecheck", "build"],
    "optional": [],
    "restoreTsbuildinfo": true
  },
  "maxPhases": 4,
  "maxRetriesPerPhase": 3,
  "maxWallClockMs": 7200000,
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
    "currentBehavior": "Fill last bar opens a popover with Auto checkbox; a second 9px dashed banner duplicates Accept/Regenerate/Revert. PatternSelect in Drum Bay and SequencerPanel can change patterns while a preview is pending with no shared pending treatment.",
    "visualCriteria": [
      "Pending fill preview is obvious at a glance in Drum Bay",
      "Committed vs pending is not the same faint amber treatment",
      "Auto-on-last-bar is findable without hunting the right-click popover only"
    ],
    "interactionCriteria": [
      "Accept / Regenerate / Revert still call the same store methods",
      "Pattern select still calls setActiveSection"
    ],
    "manualReview": "Human checks Drum Bay fill preview, Auto checkbox, and pattern switch at 1440/1366. Typecheck/build is not visual proof."
  }
}
---

# Drum fill preview presentation (LEVEL 2 LIVE)

Cursor/Composer must **not** edit application UI. Local Qwen implements this from evidence.

Discovery (`fire-ux-level2-next-discovery`) found real friction in **Drum fill preview commit ambiguity**. PianoRoll.tsx was named as a caller but **has zero `generateDrumFill` references** — do not invent piano-roll fill UI. The shared pattern switcher is `PatternSelect.tsx` (DrumMachine + SequencerPanel).

## Current evidence (inspect these)

- `DrumMachine.tsx` ~305–353: Fill last bar + popover (intensity, personality, Auto checkbox via `setDrumFillAuto`, Accept/Regenerate)
- `DrumMachine.tsx` ~475–494: second pending banner, 9px copy, duplicate Accept/Regenerate/Revert
- `PatternSelect.tsx`: compact pattern `<select>` used in Drum Bay and sequencer chrome
- `SequencerPanel.tsx`: also mounts `PatternSelect`

Parked dirty files (Gate/Macro/fireUiKit/ModuleEnableToggle) are **preserved**. Do not edit or revert them.

## Allowed work

Presentation-only in the three authorized files. You may call existing store methods. You may **not** change store files.

## Multi-phase revision (required capability)

Phase 1 may edit files A/B. If the critic finds a **substantiated** issue, a later EDITING/REPAIRING phase may revise **the same files**. Those files are mission-owned even though they are already dirty. Do not revert them to HEAD.

Do not invent a bug. Do not refuse to touch a file only because you already edited it.

## Non-goals

Audio, DSP, MIDI, persistence format, AudioEngine, fireSequencerStore.ts, Gate/Macro overflow, ModuleEnableToggle, global FcChip truncation.
