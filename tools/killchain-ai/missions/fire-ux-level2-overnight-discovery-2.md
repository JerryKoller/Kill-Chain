---
{
  "id": "fire-ux-level2-overnight-discovery-2",
  "title": "Fire Command LEVEL 2 discovery retry (read-only)",
  "goal": "Name exactly 2–4 existing Fire Command UI files for ONE coherent presentation workflow. The previous discovery collapsed to a single file (FireCommandPalette) and listed Option A/B/C — that is invalid. Pick a different workflow than Gate/Macro, ModuleEnableToggle, drum-fill, and a one-file palette toast.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/components/FireCommand/**",
    "src/state/fireCommandStore.ts",
    "src/state/fireSequencerStore.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "src/state/**",
    "electron/**",
    "src/lib/sourceArbiter.ts",
    "package.json"
  ],
  "acceptance": [
    "Exactly 2, 3, or 4 existing UI files — not 1, not 5+",
    "Real caller relationships with evidence",
    "One workflow only — no Option A/B/C",
    "Not Gate/Macro overflow, not ModuleEnableToggle, not drum-fill, not palette-only toast",
    "Do not edit parked dirty files",
    "Do not edit production files"
  ],
  "validation": { "required": [], "optional": [] },
  "maxPhases": 4,
  "maxRetriesPerPhase": 2,
  "maxWallClockMs": 1800000,
  "maxModelCalls": 14,
  "sessionTimeoutMs": 720000,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "never"
}
---

# Discovery retry

READ-ONLY. Previous pass named one file and Options A/B/C. Invalid for LEVEL 2.

Parked files are out of the later-edit list: GatePanel, MacroPanel, fireUiKit, ModuleEnableToggle.
